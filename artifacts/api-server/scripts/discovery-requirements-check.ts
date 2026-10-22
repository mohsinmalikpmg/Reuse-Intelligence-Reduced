import assert from "node:assert/strict";
import { requirementCoverage, type DiscoverySnapshot } from "../src/lib/discovery-requirements";
import type { CompositionPlan, SourceEvidence } from "../src/lib/composition-contract";
import { discoveryDomainEligible } from "../src/lib/discovery-domain";

const origin:DiscoverySnapshot={
  briefId:"fixture",sourceRevision:"revision-one",intakeId:null,intakeRevision:null,capturedAt:"2026-01-01",
  targetGroup:"Maintenance supervisors",constraints:"Human approval required",requiredControls:"No automated dispatch",
  requirements:[{id:"r1",text:"Original maintenance approval wording",priority:1},{id:"r2",text:"Detect recurring problems",priority:2},{id:"r3",text:"Integrate with production dispatch",priority:3}],
  relationships:[{requirementId:"r1",sourceSolutionId:"base",capabilityId:"review",coverage:"proposed",reason:"Documented review"},
    {requirementId:"r2",sourceSolutionId:"donor",capabilityId:"cluster",coverage:"partial",reason:"Limited grouping"}],
  startingPoint:{solutionId:"base",version:"1",reason:"Maintenance review"},
};
const evidence:SourceEvidence[]=[
  {solutionId:"base",version:"1",name:"Base",execution:"live",constraints:{},capabilities:[{id:"review"}]},
  {solutionId:"donor",version:"1",name:"Donor",execution:"live",constraints:{},capabilities:[{id:"cluster",dependsOn:["review"]}]},
];
const plan:CompositionPlan={
  title:"Maintenance plan",goal:"Maintenance approval and grouping",goalInferred:false,baseSolutionId:"base",rationale:"Fixture",
  decisions:[{solutionId:"base",disposition:"included",reason:"Review"},{solutionId:"donor",disposition:"included",reason:"Group"}],
  flow:[{sourceSolutionId:"base",capabilityId:"review",reason:"Review"},{sourceSolutionId:"donor",capabilityId:"cluster",reason:"Group"}],
  overlapDecisions:[],dependencies:[],integrationGaps:[],clarifications:[],
};
const snapshot={discoverySnapshot:origin,sourceEvidence:evidence,plan};
const original=JSON.stringify(origin);
assert.deepEqual(requirementCoverage(snapshot).map(r=>r.status),["proposed","partial","no-match"]);
const excluded={...snapshot,plan:{...plan,flow:plan.flow.slice(0,1)}};
assert.deepEqual(requirementCoverage(excluded).map(r=>r.status),["proposed","user-excluded","no-match"]);
assert.equal(requirementCoverage(snapshot)[1].status,"partial","Re-inclusion restores only proposed partial support.");
const brokenDependency={...snapshot,plan:{...plan,flow:plan.flow.slice(1)}};
assert.equal(requirementCoverage(brokenDependency)[1].status,"no-compatible-match");
const unsupported={...snapshot,sourceEvidence:evidence.map(s=>s.solutionId==="donor"?{...s,execution:"preview"}:s)};
assert.equal(requirementCoverage(unsupported)[1].status,"no-compatible-match");
const manualOff={...snapshot,supportedExecution:{capabilityIds:["review"]}};
assert.equal(requirementCoverage(manualOff)[1].status,"no-compatible-match","Saved executable edits must not falsely preserve coverage.");
const gaps={...snapshot,plan:{...plan,integrationGaps:["No validated dispatch adapter."]}};
assert.equal(requirementCoverage(gaps)[0].status,"partial","Unknown integration limits cannot yield unqualified proposed coverage.");
assert.ok(requirementCoverage(snapshot).every(r=>r.matches.every(m=>!m.executed)));
assert.deepEqual(requirementCoverage(snapshot)[2].untestedConstraints,["Human approval required","No automated dispatch"]);
assert.equal(JSON.stringify(origin),original,"Every projection preserves immutable wording, priority, origin and relationships.");
for(const id of ["invoice-finder","approval-desk","spend-tracker","budget-and-forecast","management-reporting"])
  assert.equal(discoveryDomainEligible(id,"Maintenance supervisors approve work orders and report recurring faults."),false);
assert.equal(discoveryDomainEligible("management-reporting","Generic reporting and dashboards"),false);
assert.equal(discoveryDomainEligible("budget-and-forecast","Forecast maintenance staffing demand"),false);
assert.equal(discoveryDomainEligible("invoice-finder","Find duplicate supplier invoices for accounts payable"),true);
assert.equal(discoveryDomainEligible("budget-and-forecast","Compare financial actuals with budgets and forecasts"),true);
assert.equal(discoveryDomainEligible("invoice-finder","Maintenance dispatch, not invoices."),false);
assert.equal(discoveryDomainEligible("sol-workorder-insight","Maintenance approval"),true);
console.log("Discovery requirement continuity checks passed.");
