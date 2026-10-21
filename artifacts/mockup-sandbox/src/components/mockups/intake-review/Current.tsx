import {useState,useEffect} from 'react';
import {Check,Pencil} from 'lucide-react';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import './_group.css';
type Card='today'|'better';
const useDroppable=(_: {id:string})=>({setNodeRef: (_node: HTMLElement|null)=>{}, isOver:false});
export const btn = {
  primary:
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[16px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[hsl(191_30%_23%)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  accent:
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-siennaink px-6 text-[16px] font-semibold text-white shadow-sm transition-colors hover:bg-[hsl(20_58%_32%)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-[15px] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-secondary active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  quiet:
    "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
};

// Exact EditCard extracted from Discover. API persistence is replaced with local state; external drop context is stubbed.
function EditCard(p: { id: Card; label: string; hint: string; value: string; picked: string | null; dragging: boolean; busy: boolean; onSave: (v: string) => void; onAddPicked: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `card:${p.id}` });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.value);
  useEffect(() => { if (!editing) setDraft(p.value); }, [p.value, editing]);
  return (
    <div ref={setNodeRef} data-testid={`card-${p.id}`}
      className={cn("card-soft flex min-h-[150px] flex-col p-5 transition-[border-color,box-shadow,background-color]", p.dragging && "border-dashed border-sienna/60", isOver && "border-solid border-sienna bg-accent/40 shadow-[0_0_0_3px_hsl(var(--sienna)/.2)]")}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", p.id === "today" ? "bg-sky" : "bg-ok")} />
        <span className="text-[15px] font-semibold text-primary">{p.label}</span>
        <span className="text-[13px] text-muted-foreground">{p.hint}</span>
        {!editing && <button data-testid={`button-edit-${p.id}`} onClick={() => setEditing(true)} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-primary" aria-label={`Edit ${p.label}`}><Pencil className="h-4 w-4" /></button>}
      </div>
      {editing ? (
        <div className="mt-2">
          <Textarea autoFocus data-testid={`input-${p.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[80px] text-[15.5px]" />
          <div className="mt-2 flex justify-end gap-1">
            <button className={btn.quiet} onClick={() => { setDraft(p.value); setEditing(false); }}>Cancel</button>
            <button data-testid={`button-save-${p.id}`} className={btn.secondary} disabled={p.busy} onClick={() => { p.onSave(draft.trim()); setEditing(false); }}><Check className="h-4 w-4" /> Save</button>
          </div>
        </div>
      ) : (
        <p data-testid={`text-${p.id}`} onClick={() => setEditing(true)} className="mt-2 cursor-text text-[16.5px] leading-relaxed">{p.value}</p>
      )}
      {p.picked && !editing && <button data-testid={`button-add-here-${p.id}`} onClick={p.onAddPicked} className="mt-auto self-start pt-3 text-[13.5px] font-semibold text-siennaink hover:underline">+ Add here</button>}
    </div>
  );
}

export default function Current(){const [today,setToday]=useState('Supervisors manually read maintenance work orders to find recurring equipment problems.');const [better,setBetter]=useState('Identify recurring issues and clear next actions, while flagging maintenance safety risks.');return <main className="min-h-screen bg-background px-8 py-14"><div className="mx-auto max-w-[936px]"><div className="stage-eyebrow">01 / Trace · Current intake</div><h1 className="mt-4 text-[38px]">Follow the <span className="display-accent">current.</span></h1><p className="mt-4 text-[17px] text-skyink">What are you trying to solve? Describe it the way you would to a colleague.</p><h2 className="mb-3 mt-10 text-[20px] font-semibold">Here is what we understood</h2><div className="grid gap-4 md:grid-cols-2"><EditCard id="today" label="Today" hint="What is happening now" value={today} picked={null} dragging={false} busy={false} onSave={setToday} onAddPicked={()=>{}}/><EditCard id="better" label="Better" hint="The outcome you want" value={better} picked={null} dragging={false} busy={false} onSave={setBetter} onAddPicked={()=>{}}/></div><p className="mt-6 text-sm text-muted-foreground">Extracted current understanding cards · local preview only</p></div></main>}