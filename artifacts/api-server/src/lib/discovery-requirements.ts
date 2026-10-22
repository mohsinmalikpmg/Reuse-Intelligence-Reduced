import type { CompositionPlan, SourceEvidence } from "./composition-contract";

export type RequirementRelationship = {
  requirementId:string; sourceSolutionId:string; capabilityId:string;
  coverage:"proposed"|"partial"; reason:string;
  evidenceLevel?:"documented"|"code-inspected";
};
export type DiscoverySnapshot = {
  briefId:string; sourceRevision:string; intakeId:string|null; intakeRevision:number|null;
  capturedAt:string; targetGroup:string; constraints:string; requiredControls:string;
  requirements:{id:string;text:string;priority:number;source?:string}[];
  relationships:RequirementRelationship[];
  startingPoint:{solutionId:string;version:string;reason:string};
  codeInspection?:{file:string;sha256:string;capabilityIds:string[]};
};

/** A selection is a proposal, never proof. Recompute against current flow on
 * every read; immutable mappings survive removal, undo and executable edits. */
export function requirementCoverage(snapshot:{discoverySnapshot?:DiscoverySnapshot;plan:CompositionPlan;sourceEvidence:SourceEvidence[];supportedExecution?:{capabilityIds:string[]}|null;discoveryState?:string}) {
  const origin=snapshot.discoverySnapshot;
  if(!origin)return [];
  return origin.requirements.map(requirement=>{
    const matches=origin.relationships.filter(r=>r.requirementId===requirement.id);
    const selected=matches.filter(r=>snapshot.plan.flow.some(s=>s.sourceSolutionId===r.sourceSolutionId&&s.capabilityId===r.capabilityId));
    const limitations:string[]=[];
    const compatible=selected.filter(r=>{
      const source=snapshot.sourceEvidence.find(s=>s.solutionId===r.sourceSolutionId);
      const cap=source?.capabilities.find(c=>c.id===r.capabilityId);
      const active=new Set(snapshot.plan.flow.map(s=>s.capabilityId));
      const missing=((cap?.dependsOn??[]) as string[]).filter(id=>!active.has(id));
      const conflicts=((cap?.incompatibleWith??[]) as string[]).filter(id=>active.has(id));
      if(missing.length||conflicts.length)limitations.push(`Dependency/compatibility limits for ${r.capabilityId}: missing ${missing.join(", ")}; conflicts ${conflicts.join(", ")}.`);
      const unsupported=source?.execution!=="live"&&source?.execution!=="registered-recipe";
      const inactive=snapshot.supportedExecution&&!snapshot.supportedExecution.capabilityIds.includes(r.capabilityId);
      if(unsupported||inactive)limitations.push(`${r.capabilityId} is proposed only; no active supported execution contract verifies this contribution.`);
      return !missing.length&&!conflicts.length&&!unsupported&&!inactive;
    });
    const status=!matches.length?"no-match":!selected.length?"user-excluded":!compatible.length?"no-compatible-match":
      compatible.length<matches.length||compatible.some(r=>r.coverage==="partial")||snapshot.plan.integrationGaps.length?"partial":"proposed";
    return {...requirement,status,matches:matches.map(r=>({...r,selected:selected.includes(r),evidenceLevel:r.evidenceLevel??"documented",executed:false})),limitations,
      untestedConstraints:[origin.constraints,origin.requiredControls].filter(Boolean),
      note:"Proposed requirement mapping, not demonstrated fulfillment. Executable tests do not verify the complete original need."};
  });
}
