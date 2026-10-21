import { useSearch } from 'wouter';
import IntakeShell from '@/components/intake/Shell';
import Discover from './discover';

export default function DiscoverIntake() {
  const search = useSearch();
  // Existing brief URLs remain the library-matching workspace, including results.
  return new URLSearchParams(search).get('brief') ? <Discover /> : <IntakeShell />;
}
