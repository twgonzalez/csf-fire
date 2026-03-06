# Fire Evacuation Capacity Analysis — Legal Basis and Algorithmic Defense

**System:** Fire Evacuation Capacity Analysis System
**Version:** 2.0 (multi-scenario)
**Jurisdiction:** California (adaptable to other states with equivalent statutes)
**Prepared for:** City attorneys, planning directors, and technical experts

---

## 1. Purpose and Scope

This system produces objective, ministerial determinations of whether a proposed
residential development project requires discretionary review based on its impact
on fire evacuation route capacity.

The system does not make policy decisions. It applies city-adopted thresholds to
city-adopted formulas using publicly verifiable data sources. The outputs are
reproducible: given the same inputs, the same calculation will always produce the
same result.

**What this system produces:**
- A three-tier determination: DISCRETIONARY / CONDITIONAL MINISTERIAL / MINISTERIAL
- A complete audit trail recording every input, intermediate value, and output
- A scenario-by-scenario record of the five-step algorithm applied to each standard

**What this system does not produce:**
- Professional engineering judgment
- Discretionary findings
- CEQA significance determinations (though outputs may inform one)

---

## 2. The Universal Five-Step Algorithm

Every evaluation applies the same five steps in sequence. The algorithm is identical
for all scenarios. Only the parameters differ — and parameters are adopted by the
city before any project application is submitted.

This architecture has a specific legal purpose: it makes uniform application
structurally provable, not merely asserted. A challenger cannot point to any code
path where one project received different logical treatment than another.

### Step 1 — Applicability Check
**Question:** Is this scenario relevant to this project and city?
**Method:** Defined per scenario (see §4 and §5 below)
**Output:** Boolean — applicable or not applicable
**Discretion:** Zero. The applicability criterion is a fixed geographic or categorical test.

If not applicable, the scenario returns NOT_APPLICABLE and no further steps run.
The project is not prejudiced — it simply means this particular hazard scenario does
not apply.

### Step 2 — Scale Gate
**Question:** Is the project large enough to trigger analysis?
**Method:** `dwelling_units >= unit_threshold` (integer comparison)
**Output:** Boolean — scale threshold met or not met
**Discretion:** Zero. Integer comparison against a city-adopted threshold.

If the scale threshold is not met, the project receives MINISTERIAL treatment under
this scenario. No capacity analysis is performed. This prevents regulatory burden on
small infill projects that add negligible vehicles to the network.

### Step 3 — Route Identification
**Question:** Which road segments does this scenario evaluate?
**Method:** GIS buffer around project location; intersect with scenario-specific road filter
**Output:** List of road segment identifiers (OSM IDs)
**Discretion:** Zero. Algorithmic spatial query — buffer radius and road filter criteria
are city-adopted parameters.

The buffer radius and road type filter differ between scenarios (see §4–5), but
the computational method is identical.

### Step 4 — Demand Calculation
**Question:** How many peak-hour vehicles does the project generate?
**Formula:** `project_vph = dwelling_units × vehicles_per_unit × peak_hour_mobilization`
**Output:** Vehicles per hour (continuous number)
**Discretion:** Zero. The formula is fixed. Both input factors are externally sourced:
- `vehicles_per_unit` (2.5): U.S. Census American Community Survey
- `peak_hour_mobilization` (0.57): KLD Engineering AB 747 Study, Berkeley, March 2024 (Figure 12 mobilization curve)

### Step 5 — Capacity Ratio Test
**Question:** Does this project cause any serving route to cross the LOS E/F capacity threshold?
**Method:** Marginal causation test — a route is flagged only when the project itself causes the threshold crossing:

```
baseline_vc < vc_threshold  AND  proposed_vc >= vc_threshold
```

where:
- `proposed_vc = (baseline_demand + project_vph) / capacity`
- The full project vehicle load is tested against each serving route independently (worst-case marginal impact — no division by number of routes)

Routes already failing at baseline (`baseline_vc >= vc_threshold`) are recorded in
the audit trail for transparency but do NOT trigger DISCRETIONARY — the project did
not cause that failure.

**Output:** Boolean (triggered / not triggered) + list of flagged route IDs
**Discretion:** Zero. Arithmetic comparison against a city-adopted threshold (0.95).
**Capacity source:** HCM 2022 (Highway Capacity Manual, 7th Edition) — the technical
standard for road capacity analysis accepted by California courts and CEQA practitioners.

**Why marginal causation, not baseline exceedance?**
This is the standard CEQA significance methodology: a project's impact is significant
when the project itself causes an adverse change, not when an adverse condition already
exists independently. Flagging a project because roads were already congested before
it arrived would function as a categorical prohibition on infill — HCD would likely
find this invalid under the Housing Accountability Act. The marginal test is legally
conservative: it only flags the specific project that tips a route into failure.

**Why 0.95, not 0.80?**
0.95 is the precise LOS E/F boundary in HCM 2022. Triggering discretionary review
at v/c = 0.80 (mid-LOS E) has no direct HCM anchor and could be challenged as
arbitrary. Triggering at v/c = 0.95 — the actual E/F breakpoint — ties the standard
precisely to an established technical reference. It is also more permissive of infill
(fewer projects trigger), making it harder for HCD to characterize as a categorical
prohibition while still protecting against true route failure.

### Aggregation: Most Restrictive Wins
When multiple scenarios are evaluated, the most restrictive tier prevails:

```
DISCRETIONARY (3) > CONDITIONAL MINISTERIAL (2) > MINISTERIAL (1)
NOT_APPLICABLE (0) is ignored in aggregation
```

A project passes ministerially only if no applicable scenario triggers a more
restrictive tier. This is a standard and legally conservative aggregation rule —
it parallels how CEQA uses the most restrictive threshold across impact categories.

---

## 3. Why This Is Legally Defensible

### 3.1 It Is an Objective Standard
California law distinguishes objective standards (ministerial approval) from
discretionary standards (CEQA review required). An objective standard must:
- Be quantitative — ✓ (v/c ratio, dwelling unit count, buffer radius in miles)
- Contain no professional judgment — ✓ (HCM formulas are arithmetic)
- Apply uniformly — ✓ (same algorithm, same parameters for every project)

**Statutory basis:** Government Code §65913.4 (SB 35) defines "objective standards"
as "standards that involve no personal or subjective judgment by a public official."
The same definition governs AB 2011, SB 9, AB 2097, SB 79, and the broader
ministerial/discretionary framework. This system satisfies that definition.

### 3.2 Uniform Application Is Structurally Provable
Because every project runs through the same five-step algorithm with identical logic,
a challenger cannot argue that any project received different treatment. The source
code is the standard. The parameters are the only variable — and parameters are
adopted by the city (legislative act), not chosen by staff (administrative act).

### 3.3 The Technical Basis Is Established
HCM 2022 capacity values are not the city's invention — they are the industry
standard cited in Caltrans guidance, CEQA technical studies, and federal transportation
planning. The KLD Engineering mobilization curve (57%) is derived from an AB 747
study conducted for the City of Berkeley by a licensed traffic engineering firm.
Both sources are publicly available and independently verifiable.

### 3.4 The Audit Trail Is Complete
Every output includes a machine-generated record of:
- All input values and their sources
- Every intermediate calculation
- The specific formula applied at each step
- The parameter values used and their legal citations

This is sufficient for a challenger to independently reproduce the result. An
unreproducible result is a discretionary result. This one is not.

### 3.5 Fire Zone Is Not the Gate
A common objection is: "The project isn't in a fire zone, so it shouldn't be subject
to evacuation review." This system explicitly rejects that reasoning.

Under the wildland scenario, DISCRETIONARY review is triggered by capacity impact
(Standard 4), not by fire zone location. A 200-unit project in flat downtown Berkeley
that pushes Shattuck Avenue over v/c 0.95 has the same measurable evacuation impact
as a 200-unit project in the Oakland Hills — because FHSZ residents evacuating through
that arterial are affected equally regardless of where the project sits.

Fire zone location is recorded as a **severity modifier** in the audit trail — it
affects required mitigation conditions, not the tier determination.

A project in a Zone 3 fire area that is small or well-served by high-capacity roads
will still receive ministerial approval. A project outside any fire zone that pushes
a constrained two-lane road into breakdown will trigger discretionary review.
The road math decides — not the fire zone designation.

---

## 4. Scenario A: Wildland Evacuation (Standards 1–4)

**Legal basis:** AB 747 (California Government Code §65302.15)
**Enacted:** 2021 (effective January 1, 2022)
**Requires:** Local agencies with territory in Very High Fire Hazard Severity Zones
to analyze evacuation route capacity and adopt objective development standards.

### Step 1 Parameters
| Check | Method | Legal Source |
|-------|--------|--------------|
| City has FHSZ zones | Non-empty polygon count in city boundary | CAL FIRE FHSZ dataset (OSFM ArcGIS REST API) |
| Project site in FHSZ | GIS point-in-polygon (severity modifier only) | CAL FIRE FHSZ, HAZ_CLASS field ≥ 2 |

### Step 2 Parameter
| Parameter | Value | Source |
|-----------|-------|--------|
| unit_threshold | 50 dwelling units | Vehicle-generation floor: minimum units at which project_vph exceeds baseline demand model uncertainty (derived from HCM 2022 capacity arithmetic; city-adopted) |

### Step 3 Parameters
| Parameter | Value | Source |
|-----------|-------|--------|
| Route type | is_evacuation_route == True | Network analysis (all city block group centroids → city exits) |
| Search radius | 0.5 miles | City-adopted objective standard |

### Step 5 Parameter
| Parameter | Value | Source |
|-----------|-------|--------|
| vc_threshold | 0.95 | HCM 2022 LOS E/F boundary (exact breakpoint) |

### Three-Tier Output
| Tier | Trigger | Legal Basis |
|------|---------|-------------|
| DISCRETIONARY | scale_met AND capacity_exceeded | AB 747 + HCM 2022 |
| CONDITIONAL MINISTERIAL | city_has_fhsz AND scale_met (capacity OK) | General Plan Safety Element + AB 1600 nexus |
| MINISTERIAL | city has no FHSZ zones OR below scale threshold | Project below significance threshold |

---

## 5. Scenario B: Local Evacuation Density (Standard 5 — SB 79)

**Status:** Active. Enabled citywide (`local_density.enabled: true` in
`config/parameters.yaml`). Applied to all projects regardless of transit proximity
(GTFS transit proximity gate is a Phase 3 feature — not yet implemented).

**Legal basis:**
- Government Code §65302(g) — General Plan Safety Element (evacuation route capacity)
- California Fire Code 503 — fire apparatus access road capacity
- SB 79 (2025) — objective health and safety standard carve-out: cities may impose
  objective, non-discretionary health and safety standards on by-right projects,
  provided the standard is quantitative, uniformly applied, and adopted before
  the project application is submitted.

### What This Scenario Asks
"Can the immediate neighborhood's residents and the proposed project's occupants
simultaneously evacuate through the local street network in a structure fire or
neighborhood emergency?"

This is distinct from the wildland scenario, which asks whether citywide evacuation
routes serving FHSZ areas are sufficient. A project could pass the wildland scenario
(no capacity impact on citywide routes) and fail Standard 5 (local streets are
already saturated with nearby density).

### Step 1 Parameters (when enabled)
| Check | Method | Note |
|-------|--------|------|
| Citywide applicability | `local_density.enabled == true` in config | Structure fires occur anywhere, not just FHSZ |
| Transit proximity gate | Optional: buffer from GTFS station locations | Phase 3 feature — not yet implemented |

### Step 3 Parameters
| Parameter | Value | Source |
|-----------|-------|--------|
| Route type | road_type in (multilane, two_lane) — freeways excluded | Local egress roads only |
| Search radius | 0.25 miles | KLD Engineering quarter-mile methodology |

### Activation Requirements
Before Standard 5 can be applied to any project, the city must:

1. Adopt the standard in the General Plan Safety Element or Zoning Code **before**
   any SB 79 project application is submitted in the city.
2. Set `local_density.enabled: true` in `config/parameters.yaml`.
3. Document the technical basis (this system + legal.md) in the staff report
   accompanying adoption.
4. If using the transit proximity gate: configure GTFS transit station data and
   set `require_transit_proximity: true`.

The city attorney must confirm that adoption timing satisfies SB 79's "prior adoption"
requirement for objective health and safety standards.

---

## 6. Common Legal Challenges and Responses

### Challenge 1: "This is discretionary, not objective."
**Response:** Every step is an arithmetic comparison against a city-adopted threshold.
Step 1 checks a polygon dataset. Step 2 is `units >= 50`. Step 3 is a GIS buffer.
Step 4 is multiplication. Step 5 is `demand / capacity >= 0.95`. There is no step
at which a city official exercises judgment. The standard satisfies the definition
in Government Code §65913.4 and all subsequent ministerial approval statutes.

### Challenge 2: "The parameters are arbitrary."
**Response:** No parameter was invented for this system:
- `vc_threshold = 0.95`: Exact LOS E/F boundary in HCM 2022 (Table for basic freeway/multilane segments and two-lane highways). This is the same threshold used in Caltrans Transportation Analysis Framework and federal guidance. Using 0.95 rather than a lower value makes the standard more permissive of infill and more precisely anchored to the published technical standard.
- `unit_threshold = 50`: Vehicle-generation floor — the minimum project size at which peak-hour vehicle load (`units × 2.5 × 0.57`) becomes large enough to produce a measurable change in the v/c ratio of a constrained serving route. Projects below this floor contribute less than the baseline demand model's uncertainty and cannot be shown to cause a measurable impact.
- `vehicles_per_unit = 2.5`: U.S. Census ACS — the same source used in every trip generation study.
- `peak_hour_mobilization = 0.57`: KLD Engineering TR-1381, Berkeley AB 747 Study, March 2024, Figure 12.
- `buffer_radius = 0.25 mi`: KLD Engineering quarter-mile buffer methodology (same study).

Every parameter has a published external source. The city adopts these values — it
does not invent them.

### Challenge 3: "You can't apply this standard retroactively."
**Response:** Correct — and this system does not do so. The system produces
determinations for projects submitted after the standard is adopted. The adoption
date is recorded in the city's ordinance. This system's outputs include the
evaluation date. The sequence is verifiable: adoption before application before
evaluation.

### Challenge 4: "The project isn't in a fire zone — evacuation standards don't apply."
**Response:** Under the wildland scenario, DISCRETIONARY review is triggered by
capacity impact (the project itself causes a serving route to cross v/c 0.95), not
by fire zone location. Government Code §65302.15 requires analysis of evacuation
route capacity citywide — not just within FHSZ boundaries. A project anywhere in
the city adds vehicles to the shared evacuation network. The capacity impact is
measured, not presumed.

### Challenge 5: "The data sources are unreliable."
**Response:** All data sources are published government datasets:
- FHSZ: CAL FIRE Office of State Fire Marshal ArcGIS REST API (official)
- Road network: OpenStreetMap (used by Caltrans, FEMA, and state agencies)
- Block groups: U.S. Census Bureau TIGER/Line (official)
- Housing units: Census ACS Table B25001 (official)
- Employment: LEHD LODES8 (U.S. Census Bureau / state labor agencies, official)

The system caches all data with download timestamps for audit. A 90-day TTL ensures
data recency. The metadata.yaml file in each city's data directory records the
source URL and download date for every file.

### Challenge 6: "Two projects got different results — this is inconsistent."
**Response:** Consistent application means the same algorithm with the same parameters.
Different results are expected and correct when projects have different dwelling unit
counts, different locations, or when the road network has changed between evaluations.
The audit trail for each project is independently reproducible. Show the two audit
trails and the difference in inputs will explain the difference in results.

---

## 7. Prior Adoption Requirement

**This is the city attorney's responsibility, not this system's.**

For any standard produced by this system to withstand legal challenge, the city must:

1. Adopt the standard in an ordinance amending the General Plan Safety Element or
   Zoning Code.
2. Adoption must occur before the first project application to which the standard
   is applied.
3. The ordinance must reference:
   - The technical methodology (this system)
   - The specific parameter values adopted
   - The legal authority (AB 747 for Scenario A; General Plan §65302(g) +
     Fire Code 503 + SB 79 carve-out for Scenario B)
4. The ordinance should direct staff to use this system for all evaluations and
   to attach the full audit trail to every determination.

This system generates the audit trail for steps 3 and 4. Step 1 and 2 are the
city attorney's and council's work.

---

## 8. Key Statutes and Technical References

### California Statutes
| Statute | Subject | Relevance |
|---------|---------|-----------|
| Gov. Code §65302.15 | General Plan Safety Element — evacuation route capacity | AB 747 mandate; legal basis for Scenario A |
| Gov. Code §65302(g) | General Plan Safety Element — evacuation routes | Legal basis for Scenario B (local density) |
| Gov. Code §65913.4 | SB 35 — objective standards definition | Defines "objective standard" for all ministerial approval laws |
| California Fire Code 503 | Fire apparatus access road capacity | Legal basis for local egress width and capacity standard |
| SB 79 (2025) | Transit-adjacent by-right housing | Objective health and safety standard carve-out for Scenario B |
| AB 1600 (Gov. Code §66000+) | Impact fee nexus | Basis for CONDITIONAL MINISTERIAL conditions |

### Technical References
| Document | Subject | Parameters Derived |
|----------|---------|-------------------|
| Highway Capacity Manual, 7th Ed. (HCM 2022) | Road capacity by facility type | capacity_vph by road type; vc_threshold = 0.95 (exact LOS E/F boundary) |
| KLD Engineering TR-1381, Berkeley AB 747 Study (March 2024) | Evacuation demand modeling | peak_hour_mobilization = 0.57; buffer_radius = 0.25 miles; employee_mobilization_day = 1.00 |
| U.S. Census ACS Table B25001 | Housing units by block group | Housing unit demand base; vehicles_per_unit = 2.5 |
| U.S. Census LEHD LODES8 | Workplace area characteristics by block group | Employee demand base |
| CAL FIRE FHSZ dataset (OSFM) | Fire Hazard Severity Zone polygons | Scenario A applicability gate; fire zone severity modifier |

---

## 9. Parameter Table

All parameters are configuration values in `config/parameters.yaml` or
`config/cities/{city}.yaml`. Cities adopt these values; the algorithm is fixed.

| Parameter | Default | Config Key | Source | Who Adopts |
|-----------|---------|------------|--------|------------|
| Unit threshold (discretionary) | 50 | `determination_tiers.discretionary.unit_threshold` | Vehicle-generation floor (HCM 2022 capacity arithmetic; city-adopted) | City council |
| Unit threshold (conditional) | 50 | `determination_tiers.conditional_ministerial.unit_threshold` | Same | City council |
| V/C threshold | 0.95 | `determination_tiers.discretionary.vc_threshold` | HCM 2022 exact LOS E/F boundary | City council |
| Vehicles per unit | 2.5 | `vehicles_per_unit` | U.S. Census ACS | U.S. Census (city inherits) |
| Peak-hour mobilization | 0.57 | `peak_hour_mobilization` | KLD Engineering AB 747 study | City council (adopts study) |
| AADT peak-hour factor | 0.10 | `aadt_peak_hour_factor` | Standard traffic engineering practice | City council |
| Evacuation route radius | 0.5 mi | `evacuation_route_radius_miles` | City-adopted objective standard | City council |
| FHSZ trigger zones | [2, 3] | `fhsz.trigger_zones` | CAL FIRE zone classification | State (CAL FIRE) |
| Buffer demand radius | 0.25 mi | `demand.buffer_radius_miles` | KLD Engineering AB 747 methodology | City council (adopts study) |
| Employee mobilization (day) | 1.00 | `demand.employee_mobilization_day` | KLD Engineering AB 747 methodology | City council |
| Cache TTL | 90 days | `cache_ttl_days` | Operational parameter | City IT / planning dept. |
| Std 5 unit threshold | 50 | `local_density.unit_threshold` | Consistent with Scenario A | City council |
| Std 5 V/C threshold | 0.95 | `local_density.vc_threshold` | HCM 2022 exact LOS E/F boundary | City council |
| Std 5 local radius | 0.25 mi | `local_density.radius_miles` | KLD Engineering quarter-mile | City council |
| Std 5 transit buffer | 2640 ft | `local_density.transit_buffer_feet` | SB 79 — 0.5 mile transit definition | State (SB 79) |

---

## 10. Audit Trail Description

Every `evaluate` command produces a text file at `output/{city}/determination_{lat}_{lon}.txt`.
This file is the legal record. It contains:

1. **Project identification** — date, location, dwelling units, APN
2. **Algorithm identification** — system version, algorithm name, legal.md reference
3. **Per-scenario record** — for each scenario:
   - Legal basis
   - Tier result and triggered flag
   - Step 1: applicability inputs and output
   - Step 2: scale comparison (units vs. threshold)
   - Step 3: route identification (radius, count, per-route v/c and LOS)
   - Step 4: demand calculation (formula, factor sources)
   - Step 5: ratio test (per-route baseline and proposed v/c, flagged routes)
4. **Final determination** — most restrictive tier, scenario tier summary, aggregation logic

This record is sufficient for:
- Planning commission staff reports
- Administrative appeal records
- Judicial review (Code of Civil Procedure §1094.5 mandamus standard)
- AB 1600 nexus documentation

The audit trail is machine-generated from the same code that produces the determination.
It cannot be edited without re-running the algorithm.
