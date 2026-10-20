import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PhysicalModel, SpatialCategory, StandaloneDb } from "@itwin/core-backend";
import { DbResult, Guid, Id64, OpenMode } from "@itwin/core-bentley";
import { Code, GeometryStreamBuilder, IModel, SubCategoryAppearance } from "@itwin/core-common";
import { LineSegment3d, Point3d, YawPitchRollAngles } from "@itwin/core-geometry";
import { exportEmptyStandaloneCopy } from "../src/Logic/EmptyStandaloneExport";
import { dumpSchemas } from "../src/Logic/SchemaDump";
import { cleanupTestDir, ensureIModelHost, getTestDir, shutdownIModelHost } from "./TestHelper";

function schemaXml(name: string, className: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ECSchema schemaName="${name}" alias="${name.toLowerCase()}" version="01.00.00" xmlns="http://www.bentley.com/schemas/Bentley.ECXML.3.2">
  <ECSchemaReference name="BisCore" version="01.00.00" alias="bis"/>
  <ECEntityClass typeName="${className}">
    <BaseClass>bis:PhysicalElement</BaseClass>
    <ECProperty propertyName="Label" typeName="string"/>
  </ECEntityClass>
  <ECEntityClass typeName="${className}Aspect">
    <BaseClass>bis:ElementUniqueAspect</BaseClass>
    <ECProperty propertyName="Note" typeName="string"/>
  </ECEntityClass>
</ECSchema>`;
}

function count(db: StandaloneDb, sql: string): number {
  return db.withSqliteStatement(sql, (stmt) => {
    expect(stmt.step()).toBe(DbResult.BE_SQLITE_ROW);
    return stmt.getValueInteger(0);
  });
}

describe("exportEmptyStandaloneCopy", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  afterAll(async () => {
    cleanupTestDir();
    await shutdownIModelHost();
  });

  it("keeps schemas and mappings and deletes data", async () => {
    const sourcePath = path.join(getTestDir(), "empty-export-source.bim");
    const source = StandaloneDb.createEmpty(sourcePath, { rootSubject: { name: "Source" }, enableTransactions: true });
    try {
      await source.importSchemaStrings([schemaXml("HuskTest", "Widget")]);
      const categoryId = SpatialCategory.insert(source, IModel.dictionaryId, "Category", new SubCategoryAppearance());
      const modelId = PhysicalModel.insert(source, IModel.rootSubjectId, "Physical");
      const geometry = new GeometryStreamBuilder();
      geometry.appendGeometry(LineSegment3d.create(Point3d.create(0, 0, 0), Point3d.create(1, 1, 1)));
      for (let i = 0; i < 3; i++) {
        const elementId = source.elements.insertElement({
          classFullName: "HuskTest:Widget",
          model: modelId,
          category: categoryId,
          code: Code.createEmpty(),
          placement: { origin: Point3d.create(i, 0, 0), angles: YawPitchRollAngles.createDegrees(0, 0, 0) },
          geom: geometry.geometryStream,
          label: `Widget ${i}`,
        } as Parameters<typeof source.elements.insertElement>[0]);
        source.elements.insertAspect({ classFullName: "HuskTest:WidgetAspect", element: { id: elementId }, note: "aspect" } as Parameters<typeof source.elements.insertAspect>[0]);
      }
      source.saveChanges();
      expect(count(source, "SELECT COUNT(*) FROM dgn_SpatialIndex")).toBe(3);

      const targetPath = path.join(getTestDir(), "empty-export-target.bim");
      const result = await exportEmptyStandaloneCopy(source, targetPath);
      expect(result.keptTables).toEqual(["bis_CodeSpec"]);

      const metadataCounts = (db: StandaloneDb) => ["ec_Schema", "ec_Class", "ec_Property", "ec_PropertyMap", "ec_Table", "ec_Column", "ec_Index", "bis_CodeSpec"]
        .map(table => count(db, `SELECT COUNT(*) FROM ${table}`));
      const target = StandaloneDb.openFile(targetPath, OpenMode.ReadWrite);
      try {
        expect(target.iTwinId).toBe(Guid.empty);
        expect(metadataCounts(target)).toEqual(metadataCounts(source));
        const bootstrapIds = [IModel.rootSubjectId, "0xe", IModel.dictionaryId].map(id => Id64.getLocalId(id)).join(",");
        expect(count(target, `SELECT COUNT(*) FROM bis_Element WHERE Id NOT IN (${bootstrapIds})`)).toBe(0);
        expect(count(target, "SELECT COUNT(*) FROM bis_Element")).toBe(3);
        expect(count(target, "SELECT COUNT(*) FROM bis_Model")).toBe(3);
        expect(count(target, "SELECT COUNT(*) FROM bis_ElementUniqueAspect")).toBe(0);
        expect(count(target, "SELECT COUNT(*) FROM dgn_SpatialIndex")).toBe(0);

        // The copy keeps working as an iModel: the mapped class is queryable and further schema imports succeed.
        const widgets = await target.createQueryReader("SELECT COUNT(*) FROM HuskTest.Widget").toArray();
        expect(widgets[0][0]).toBe(0);
        await target.importSchemaStrings([schemaXml("HuskTestTwo", "Gadget")]);
        target.saveChanges();
      } finally {
        target.close();
      }
    } finally {
      source.close();
    }
  });

  it("refuses to overwrite an existing file", async () => {
    const sourcePath = path.join(getTestDir(), "empty-export-overwrite.bim");
    const source = StandaloneDb.createEmpty(sourcePath, { rootSubject: { name: "Source" } });
    try {
      const targetPath = path.join(getTestDir(), "empty-export-existing.bim");
      fs.writeFileSync(targetPath, "keep me");
      await expect(exportEmptyStandaloneCopy(source, targetPath)).rejects.toThrow("already exists");
      expect(fs.readFileSync(targetPath, "utf-8")).toBe("keep me");
    } finally {
      source.close();
    }
  });
});

describe("dumpSchemas", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  it("writes each schema and a manifest", async () => {
    const dbPath = path.join(getTestDir(), "schema-dump.bim");
    const db = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Dump" } });
    try {
      await db.importSchemaStrings([schemaXml("DumpTest", "Thing")]);
      const outDir = path.join(getTestDir(), "schema-dump-out");
      const manifest = dumpSchemas(db, outDir);

      expect(manifest.schemas.filter(s => s.error !== undefined)).toEqual([]);
      const dumpTest = manifest.schemas.find(s => s.name === "DumpTest");
      expect(dumpTest).toMatchObject({ version: "01.00.00", originalECXmlVersion: "3.2", writtenECXmlVersion: "3.2", fileName: "DumpTest.01.00.00.ecschema.xml" });
      expect(fs.readFileSync(path.join(outDir, dumpTest!.fileName!), "utf-8")).toContain("Bentley.ECXML.3.2");
      const written = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf-8"));
      expect(written.schemas).toHaveLength(manifest.schemas.length);
    } finally {
      db.close();
    }
  });
});
