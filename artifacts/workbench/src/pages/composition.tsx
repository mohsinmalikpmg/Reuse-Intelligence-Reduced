import { Redirect, useParams } from "wouter";

/** Legacy address: saved combinations now open in the workbench itself. */
export default function CompositionPage() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/workbench/${id}`} replace />;
}
