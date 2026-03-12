# ECSql Query Guide for iModels

ECSql is SQL (SQL-92/99) extended for ECSchemas. It targets the **logical schema**, not the persistence schema. Only SELECT is available via the query API.

## Syntax Essentials

### Qualifying Classes
Always qualify with `SchemaNameOrAlias.ClassName`:
```sql
SELECT * FROM BisCore.Element
SELECT * FROM bis.Element        -- alias form
```
Both `.` and `:` are valid delimiters (`bis:Element` works too).

### System Properties
Every instance has these implicit properties:
- `ECInstanceId` - unique identifier (Id)
- `ECClassId` - class identifier, renders as qualified name in SELECT

Relationships add:
- `SourceECInstanceId`, `SourceECClassId`
- `TargetECInstanceId`, `TargetECClassId`

### Parameters
```sql
WHERE Model = ?                              -- positional
WHERE Model = :modelId                       -- named (reusable)
LIMIT :pagesize OFFSET (:pageno * :pagesize) -- expressions ok
```

### Polymorphic Queries (DEFAULT)
Queries are **polymorphic by default** (include all subclasses):
```sql
SELECT * FROM bis.Element WHERE Model = ?          -- all Element subclasses
SELECT * FROM ALL bis.Element WHERE Model = ?      -- same (explicit)
SELECT * FROM ONLY bis.Element WHERE Model = ?     -- exact class only, no subclasses
```

### ECClassId Filtering
Filter by class type using `IS` operator:
```sql
WHERE ECClassId IS (plant.PUMP, plant.PIPE)              -- polymorphic (includes subclasses)
WHERE ECClassId IS (ONLY plant.PUMP, ONLY plant.PIPE)    -- exact types only
WHERE ECClassId IS NOT (plant.PUMP, plant.PIPE)          -- exclude types
```

### Navigation Properties
Navigation properties point to related instances. They are structs with `.Id` and `.RelECClassId`:
```sql
SELECT Parent FROM bis.Element WHERE ECInstanceId = ?           -- returns {Id, RelECClassId}
SELECT Parent.Id FROM bis.Element WHERE ECInstanceId = ?        -- just the Id
SELECT Model.Id, Model.RelECClassId FROM bis.Element            -- both members
```
Navigation properties provide shortcuts that avoid explicit JOINs.

### JOINs
Standard SQL JOINs (INNER, LEFT, RIGHT, FULL) are supported.

**Using navigation property (preferred, 1 JOIN):**
```sql
SELECT e.CodeValue, e.UserLabel FROM bis.Element e
  JOIN bis.Model m ON e.Model.Id = m.ECInstanceId
  WHERE m.Name = ?
```

**Using relationship class (2 JOINs needed):**
```sql
SELECT driven.CodeValue FROM bis.Element driver
  JOIN bis.ElementDrivesElement ede ON driver.ECInstanceId = ede.SourceECInstanceId
  JOIN bis.Element driven ON driven.ECInstanceId = ede.TargetECInstanceId
  WHERE driven.ECInstanceId = ?
```

**JOIN USING (auto-applies relationship):**
```sql
SELECT * FROM bis.Element t0
  JOIN bis.Element t1 USING bis.ElementOwnsChildElements BACKWARD
```
Note: JOIN USING is slower than navigation property JOINs for FK-mapped relationships.

### Points
Point2d has `.X`, `.Y`; Point3d adds `.Z`:
```sql
WHERE Origin.X BETWEEN 3500000.0 AND 3500500.0
  AND Origin.Y BETWEEN 5700000.0 AND 5710000.0
  AND Origin.Z BETWEEN 0 AND 100.0
```

### Structs
Access members with `.`:
```sql
SELECT Location.Street, Location.City FROM myschema.Company
WHERE Location.Zip = 12314
```

### Arrays
Referenced as complete units only (no element access):
```sql
SELECT PhoneNumbers FROM myschema.Company WHERE Name = 'ACME'
```

### Boolean
```sql
WHERE IsCameraOn = True
WHERE IsCameraOn           -- shorthand for True
WHERE NOT IsCameraOn       -- shorthand for False
```

### DateTime
```sql
WHERE LastMod > DATE '2018-01-01'
WHERE LastMod < TIMESTAMP '2017-07-15T12:00:00.000Z'
WHERE startTime >= TIME '08:30:00'
```
Built-in: `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `CURRENT_TIME`

### LIMIT/OFFSET
```sql
SELECT * FROM bis.Element WHERE Model = ? LIMIT 50 OFFSET 200
```

### CASE/IIF
```sql
SELECT CASE WHEN IsPrivate THEN 'Private' ELSE 'Public' END FROM bis.Model
SELECT IIF(IsPrivate, 'Private', 'Public') FROM bis.Model
```

### Common Table Expressions (CTEs)
```sql
WITH RECURSIVE assembly (Id, ParentId, Code, Depth) AS (
  SELECT ECInstanceId, Parent.Id, CodeValue, 1
    FROM bis.Element WHERE Parent.Id IS NULL
  UNION ALL
  SELECT c.ECInstanceId, c.Parent.Id, c.CodeValue, p.Depth + 1
    FROM bis.Element c
    JOIN assembly p ON p.Id = c.Parent.Id
)
SELECT * FROM assembly WHERE Depth > 3 LIMIT 100
```

## Built-in ECSql Functions

| Function | Description |
|---|---|
| `ec_classname(ecclassId [, format])` | Get class name. Formats: `'s:c'`(default), `'a:c'`, `'s'`, `'a'`, `'c'`, `'s.c'`, `'a.c'` |
| `ec_classid('schema.class')` | Get ECClassId from qualified name. Also: `ec_classid('schema','class')` |
| `regexp(pattern, value)` | Regex match (Google RE2 syntax) |
| `regexp_extract(value, pattern [, rewrite])` | Extract regex groups. `\0`=full, `\1`,`\2`=groups |
| `strToGuid(guid_string)` | Convert string GUID to binary |
| `guidToStr(binary_guid)` | Convert binary GUID to string |
| `navigation_value(path, Id [, RelECClassId])` | Construct navigation property value |

All SQLite scalar functions are also available (`substr`, `lower`, `upper`, `length`, `coalesce`, `json_extract`, etc.).

## Instance Queries

The `$` operator provides access to properties defined in derived classes when querying a base class:
```sql
SELECT $ FROM bis.Element WHERE ECInstanceId = 0xc000000014c     -- full JSON instance
SELECT $->[CodeValue] FROM bis.Element WHERE $->[CodeValue] IS NOT NULL LIMIT 1
SELECT $->[RevitId], $->[LastModifier] FROM bis.Element WHERE $->[Asset_Tag] = 'COMPUTER 005'
```

Rules:
- Only top-level properties via `$->[prop]` (no `$->Model.Id`)
- Composite properties return JSON; use `JSON_EXTRACT($->[Model], '$.Id')` for nested values
- Non-existent properties return no rows
- Append `?` for optional properties: `$->[Foo?]` (won't filter out rows lacking `Foo`, but slower)
- Supported filter types: DateTime, Integer, Long, Binary, String, Double
- Works in WHERE, ORDER BY, subqueries

## ECSQLOPTIONS
```sql
SELECT $ FROM bis.Element OPTIONS USE_JS_PROP_NAMES              -- JS-compatible property names
SELECT * FROM bis.Element OPTIONS DO_NOT_TRUNCATE_BLOB           -- full blob data
SELECT * FROM t, IdSet(?) WHERE id = ECInstanceId ECSQLOPTIONS ENABLE_EXPERIMENTAL_FEATURES
```

## IdSet Virtual Table (Experimental)
Convert JSON ID arrays to queryable tables:
```sql
SELECT * FROM bis.Element, IdSet('[21, 24, 25]')
  WHERE id = ECInstanceId ECSQLOPTIONS ENABLE_EXPERIMENTAL_FEATURES
```
Accepts hex strings `["0x15"]`, decimal `[21]`, or decimal strings `["21"]`.

## Pragmas
```sql
PRAGMA ecdb_ver                        -- ECDb version info
PRAGMA explain_query SELECT ...        -- query plan explanation
PRAGMA experimental_features_enabled   -- check/toggle experimental features
```

---

## BisCore Schema (alias: `bis`)

### Element Hierarchy

**bis.Element** (Abstract) - Base for all elements
| Property | Type | Notes |
|---|---|---|
| ECInstanceId | Id | System property |
| ECClassId | ClassId | System property |
| Model | Navigation | -> Model via ModelContainsElements |
| CodeSpec | Navigation | -> CodeSpec via CodeSpecSpecifiesCode |
| CodeScope | Navigation | -> Element via ElementScopesCode |
| CodeValue | string | Nullable, text of element's Code |
| UserLabel | string | Nullable, user-friendly name |
| Parent | Navigation | -> Element via ElementOwnsChildElements |
| FederationGuid | binary (BeGuid) | Nullable, cross-repo GUID |
| LastMod | dateTime | UTC, read-only |
| JsonProperties | string (Json) | Ad hoc JSON storage |

**bis.GeometricElement** (Abstract) -> Element
**bis.GeometricElement3d** (Abstract) -> GeometricElement
| Property | Type | Notes |
|---|---|---|
| Category | Navigation | -> SpatialCategory |
| InSpatialIndex | boolean | In spatial index? |
| Origin | Point3d | Placement origin (X, Y, Z) |
| Yaw | double | Rotation angle (degrees) |
| Pitch | double | Rotation angle (degrees) |
| Roll | double | Rotation angle (degrees) |

**bis.GeometricElement2d** (Abstract) -> GeometricElement
| Property | Type | Notes |
|---|---|---|
| Category | Navigation | -> DrawingCategory |

**bis.PhysicalElement** (Abstract) -> GeometricElement3d
| Property | Type | Notes |
|---|---|---|
| TypeDefinition | Navigation | -> PhysicalType |

**bis.SpatialLocationElement** (Abstract) -> GeometricElement3d
| Property | Type | Notes |
|---|---|---|
| TypeDefinition | Navigation | -> SpatialLocationType |

**bis.GraphicalElement3d** (Abstract) -> GeometricElement3d
| Property | Type | Notes |
|---|---|---|
| TypeDefinition | Navigation | -> TypeDefinitionElement |

**bis.GraphicalElement2d** (Abstract) -> GeometricElement2d
| Property | Type | Notes |
|---|---|---|
| TypeDefinition | Navigation | -> GraphicalType2d |

**bis.DrawingGraphic** -> GraphicalElement2d

### Information Elements

**bis.InformationContentElement** (Abstract) -> Element
**bis.DefinitionElement** (Abstract) -> InformationContentElement
| Property | Type | Notes |
|---|---|---|
| IsPrivate | boolean | Hidden from GUI? |

**bis.TypeDefinitionElement** (Abstract) -> DefinitionElement
| Property | Type | Notes |
|---|---|---|
| Recipe | Navigation | -> RecipeDefinitionElement |

**bis.PhysicalType** (Abstract) -> TypeDefinitionElement
| Property | Type | Notes |
|---|---|---|
| PhysicalMaterial | Navigation | -> PhysicalMaterial |

**bis.SpatialLocationType** (Abstract) -> TypeDefinitionElement
**bis.GraphicalType2d** (Abstract) -> TypeDefinitionElement

**bis.InformationReferenceElement** (Abstract) -> InformationContentElement
**bis.Subject** (Sealed) -> InformationReferenceElement
| Property | Type | Notes |
|---|---|---|
| Description | string | Description of real-world object |

**bis.GroupInformationElement** (Abstract) -> InformationReferenceElement
**bis.InformationRecordElement** (Abstract) -> InformationContentElement

**bis.LinkElement** (Abstract) -> InformationReferenceElement
**bis.UrlLink** -> LinkElement: `Url` (string/URI), `Description` (string)
**bis.RepositoryLink** -> UrlLink: `RepositoryGuid` (BeGuid), `Format` (string)
**bis.EmbeddedFileLink** -> LinkElement: `Name` (string), `Description` (string)

**bis.Document** (Abstract) -> InformationContentElement
**bis.Drawing** -> Document: `ScaleFactor` (double)
**bis.SectionDrawing** -> Drawing: `SectionType` (enum), `SpatialView` (Navigation)
**bis.Sheet** -> Document: `Scale` (double), `Height` (double), `Width` (double), `SheetTemplate` (Navigation)

### Partitions (establish modeling perspectives under Subject)
**bis.InformationPartitionElement** (Abstract) -> InformationContentElement
| Property | Type | Notes |
|---|---|---|
| Description | string | Human-readable intent |

Concrete partitions (all Sealed): `DefinitionPartition`, `DocumentPartition`, `GroupInformationPartition`, `InformationRecordPartition`, `LinkPartition`, `PhysicalPartition`, `SpatialLocationPartition`, `GraphicalPartition3d`

### Categories

**bis.Category** (Abstract) -> DefinitionElement
**bis.SpatialCategory** -> Category (for GeometricElement3d)
**bis.DrawingCategory** -> Category (for GeometricElement2d)
**bis.SubCategory** -> DefinitionElement (child of Category)

### Aspects

**bis.ElementAspect** (Abstract)
**bis.ElementUniqueAspect** (Abstract) -> ElementAspect - one per element per type
**bis.ElementMultiAspect** (Abstract) -> ElementAspect - multiple per element

### Definition Groups/Containers

**bis.DefinitionSet** (Abstract) -> DefinitionElement: `Rank` (enum: System=0, Domain=1, Application=2, User=3)
**bis.DefinitionContainer** -> DefinitionSet (owns sub-model)
**bis.DefinitionGroup** -> DefinitionSet (non-exclusive grouping)

### Model Hierarchy

**bis.Model** (Abstract)
| Property | Type | Notes |
|---|---|---|
| ECInstanceId | Id | System property |
| ECClassId | ClassId | System property |
| ModeledElement | Navigation (read-only) | -> Element via ModelModelsElement |
| ParentModel | Navigation (read-only) | -> Model via ModelOwnsSubModel |
| IsPrivate | boolean | Hidden from user? |
| IsTemplate | boolean | Template for new instances? |
| JsonProperties | string (Json) | Ad hoc JSON |
| LastMod | dateTime | UTC, last element modification |

**bis.GeometricModel** (Abstract) -> Model: `GeometryGuid` (BeGuid)
**bis.GeometricModel3d** (Abstract) -> GeometricModel: `IsNotSpatiallyLocated` (bool), `IsPlanProjection` (bool)
**bis.GeometricModel2d** (Abstract) -> GeometricModel: `GlobalOrigin` (Point2d)
**bis.SpatialModel** (Abstract) -> GeometricModel3d
**bis.PhysicalModel** -> SpatialModel
**bis.SpatialLocationModel** -> SpatialModel
**bis.GraphicalModel3d** (Abstract) -> GeometricModel3d
**bis.GraphicalModel2d** (Abstract) -> GeometricModel2d
**bis.DrawingModel** -> GraphicalModel2d
**bis.SheetModel** -> GraphicalModel2d
**bis.InformationModel** (Abstract) -> Model
**bis.DefinitionModel** -> InformationModel
**bis.DocumentListModel** -> InformationModel
**bis.GroupInformationModel** (Abstract) -> InformationModel
**bis.InformationRecordModel** -> InformationModel
**bis.LinkModel** -> InformationModel
**bis.RepositoryModel** (Sealed) -> DefinitionModel (singleton root)
**bis.DictionaryModel** (Sealed) -> DefinitionModel (singleton global defs)

### Key Relationships

| Relationship | Strength | Source -> Target |
|---|---|---|
| `ModelContainsElements` (Sealed) | Embedding | Model (1..1) -> Element (0..*) |
| `ModelModelsElement` | Embedding | Model (0..1) -> ISubModeledElement (0..1) |
| `ModelOwnsSubModel` (Sealed) | Embedding | Model (0..1) -> Model (0..*) |
| `ElementOwnsChildElements` (Abstract) | Embedding | Element (0..1) -> Element (0..*) |
| `ElementRefersToElements` (Abstract) | Referencing | Element (0..*) -> Element (0..*) |
| `ElementGroupsMembers` (Abstract) | Referencing | Element (0..*) -> Element (0..*) |
| `ElementDrivesElement` | | Element -> Element (with Status property) |
| `SubjectOwnsSubjects` | | Subject (0..1) -> Subject (0..*) |
| `SubjectOwnsPartitionElements` | | Subject (0..1) -> InformationPartitionElement (0..*) |
| `GeometricElement3dIsInCategory` | | GeometricElement3d -> SpatialCategory |
| `GeometricElement2dIsInCategory` | | GeometricElement2d -> DrawingCategory |
| `PhysicalElementIsOfType` | | PhysicalElement -> PhysicalType |
| `SpatialLocationIsOfType` | | SpatialLocationElement -> SpatialLocationType |
| `GraphicalElement2dIsOfType` | | GraphicalElement2d -> GraphicalType2d |
| `ElementOwnsUniqueAspect` | Embedding | Element -> ElementUniqueAspect |
| `ElementOwnsMultiAspects` | Embedding | Element -> ElementMultiAspect |
| `DefinitionGroupGroupsDefinitions` | | DefinitionGroup (0..*) -> DefinitionElement (0..*) |
| `CodeSpecSpecifiesCode` (Sealed) | Referencing | CodeSpec (1..1) -> Element (0..*) |

### Mixins
- **ISubModeledElement** - Element can be broken down by a sub-Model
- **IParentElement** - Element can own child Elements

### CodeSpec (Sealed)
| Property | Type |
|---|---|
| Name | string (unique) |
| JsonProperties | string (Json) |

---

## ECDbMeta Schema (alias: `meta`)

For schema introspection at runtime. All classes are Sealed.

### meta.ECSchemaDef
| Property | Type |
|---|---|
| Name | string |
| DisplayLabel | string |
| Description | string |
| Alias | string |
| VersionMajor | int |
| VersionWrite | int |
| VersionMinor | int |

### meta.ECClassDef
| Property | Type | Notes |
|---|---|---|
| Schema | Navigation | -> ECSchemaDef |
| Name | string | |
| DisplayLabel | string | |
| Description | string | |
| Type | ECClassType enum | Entity=0, Relationship=1, Struct=2, CustomAttribute=3 |
| Modifier | ECClassModifier enum | None=0, Abstract=1, Sealed=2 |
| CustomAttributeContainerType | enum | Where CA can be applied |
| RelationshipStrength | enum | Referencing=0, Holding=1, Embedding=2 (relationships only) |
| RelationshipStrengthDirection | enum | Forward=1, Backward=2 (relationships only) |

### meta.ECPropertyDef
| Property | Type | Notes |
|---|---|---|
| Class | Navigation | -> ECClassDef |
| Name | string | |
| DisplayLabel | string | |
| Description | string | |
| IsReadonly | boolean | |
| Priority | int | |
| Ordinal | int | Position in class |
| Kind | ECPropertyKind enum | Primitive=0, Struct=1, PrimitiveArray=2, StructArray=3, Navigation=4 |
| PrimitiveType | PrimitiveType enum | Binary=257, Boolean=513, DateTime=769, Double=1025, Integer=1281, Long=1537, Point2d=1793, Point3d=2049, String=2305, IGeometry=2561 |
| PrimitiveTypeMinLength | int | Min string/blob length |
| PrimitiveTypeMaxLength | int | Max string/blob length |
| PrimitiveTypeMinValue | double | Min numeric value |
| PrimitiveTypeMaxValue | double | Max numeric value |
| Enumeration | Navigation | -> ECEnumerationDef |
| ExtendedTypeName | string | e.g. "Json", "BeGuid", "URI" |
| StructClass | Navigation | -> ECClassDef (for struct properties) |
| KindOfQuantity | Navigation | -> KindOfQuantityDef |
| Category | Navigation | -> PropertyCategoryDef |
| ArrayMinOccurs | int | For array properties |
| ArrayMaxOccurs | int | For array properties |
| NavigationRelationshipClass | Navigation | -> ECClassDef (for nav properties) |
| NavigationDirection | enum | Forward=1, Backward=2 |

### meta.ECEnumerationDef
| Property | Type |
|---|---|
| Schema | Navigation -> ECSchemaDef |
| Name | string |
| DisplayLabel | string |
| Description | string |
| Type | PrimitiveType (underlying type) |
| IsStrict | boolean |
| EnumValues | ECEnumeratorDef[] (struct array) |

### meta.ECEnumeratorDef (Struct)
| Property | Type |
|---|---|
| Name | string |
| DisplayLabel | string |
| IntValue | int |
| StringValue | string |

### meta.ECRelationshipConstraintDef
| Property | Type | Notes |
|---|---|---|
| RelationshipClass | Navigation | -> ECClassDef |
| RelationshipEnd | enum | Source=0, Target=1 |
| MultiplicityLowerLimit | int | |
| MultiplicityUpperLimit | int | |
| IsPolymorphic | boolean | |
| RoleLabel | string | |
| AbstractConstraintClass | Navigation | -> ECClassDef |

### meta.KindOfQuantityDef
| Property | Type |
|---|---|
| Schema | Navigation -> ECSchemaDef |
| Name | string |
| PersistenceUnit | string |
| RelativeError | double |
| PresentationUnits | string[] |

### meta.PropertyCategoryDef
| Property | Type |
|---|---|
| Schema | Navigation -> ECSchemaDef |
| Name | string |
| DisplayLabel | string |
| Priority | int |

### meta.CustomAttribute
| Property | Type |
|---|---|
| ContainerId | long (Id) |
| ContainerType | CAContainerType enum (Schema=1, Class=30, Property=992) |
| Ordinal | int |
| Instance | string (Xml) |
| Class | Navigation -> ECClassDef |

### Relationships (all in meta schema)
`SchemaOwnsClasses`, `ClassOwnsLocalProperties`, `SchemaOwnsEnumerations`, `PropertyHasEnumeration`, `PropertyHasStructType`, `PropertyHasNavigationRelationshipClassId`, `RelationshipHasConstraints`, `RelationshipConstraintHasAbstractConstraintClass`, `SchemaOwnsKindOfQuantities`, `PropertyHasKindOfQuantity`, `PropertyHasCategory`, `SchemaOwnsPropertyCategories`

---

## Common Query Patterns

### List all schemas
```sql
SELECT Name, Alias, VersionMajor, VersionWrite, VersionMinor FROM meta.ECSchemaDef ORDER BY Name
```

### List classes in a schema
```sql
SELECT c.Name, c.Type, c.Modifier FROM meta.ECClassDef c
  JOIN meta.ECSchemaDef s ON c.Schema.Id = s.ECInstanceId
  WHERE s.Name = 'BisCore' ORDER BY c.Name
```

### List properties of a class
```sql
SELECT p.Name, p.Kind, p.PrimitiveType, p.DisplayLabel FROM meta.ECPropertyDef p
  JOIN meta.ECClassDef c ON p.Class.Id = c.ECInstanceId
  JOIN meta.ECSchemaDef s ON c.Schema.Id = s.ECInstanceId
  WHERE s.Name = 'BisCore' AND c.Name = 'Element'
```

### Find elements in a model
```sql
SELECT ECInstanceId, ECClassId, CodeValue, UserLabel FROM bis.Element WHERE Model.Id = ?
```

### Find elements by category
```sql
SELECT ECInstanceId, UserLabel FROM bis.GeometricElement3d WHERE Category.Id = ?
```

### Find elements by class name
```sql
SELECT ECInstanceId, UserLabel FROM bis.Element
  WHERE ec_classname(ECClassId, 'c') = 'Wall'
```

### Get model for an element
```sql
SELECT m.ECInstanceId, m.ECClassId FROM bis.Model m
  JOIN bis.Element e ON e.Model.Id = m.ECInstanceId
  WHERE e.ECInstanceId = ?
```

### Traverse parent-child hierarchy
```sql
WITH RECURSIVE hierarchy (Id, ParentId, Label, Depth) AS (
  SELECT ECInstanceId, Parent.Id, UserLabel, 0 FROM bis.Element WHERE ECInstanceId = ?
  UNION ALL
  SELECT e.ECInstanceId, e.Parent.Id, e.UserLabel, h.Depth + 1
    FROM bis.Element e JOIN hierarchy h ON e.ECInstanceId = h.ParentId
)
SELECT * FROM hierarchy
```

### Find children of an element
```sql
SELECT ECInstanceId, ECClassId, UserLabel FROM bis.Element WHERE Parent.Id = ?
```

### Subject/Partition/Model structure
```sql
SELECT s.ECInstanceId, s.CodeValue SubjectName, s.Description
  FROM bis.Subject s ORDER BY s.CodeValue
```

### Physical elements with type info
```sql
SELECT e.ECInstanceId, e.UserLabel, e.TypeDefinition.Id
  FROM bis.PhysicalElement e WHERE e.Model.Id = ?
```

### Count elements by class
```sql
SELECT ec_classname(ECClassId, 'a:c') ClassName, COUNT(*) Cnt
  FROM bis.Element GROUP BY ECClassId ORDER BY Cnt DESC LIMIT 20
```

### Find elements by FederationGuid
```sql
SELECT ECInstanceId, ECClassId, UserLabel FROM bis.Element
  WHERE FederationGuid = strToGuid('407bfa18-944d-11ee-b9d1-0242ac120002')
```
