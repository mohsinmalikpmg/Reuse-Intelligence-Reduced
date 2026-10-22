/** Transport normalization for the existing note reader, not a new ingestion engine. */
export const INPUT_MAX_BYTES=256*1024;
export const INPUT_MAX_ROWS=2000;
export const NOTE_FIELDS=["id","date","site","equipment","note"];
export type InputIssue={code:string;message:string;row?:number;field?:string};
export type InputContract={version:string;sourceSolutionId:string;ingestionCapabilityIds:string[];supportedFormats:string[];expectedFields:string[];description:string;compatible:boolean;reason:string};
export class WorkbenchInputError extends Error {
  constructor(message:string,public issues:InputIssue[],public contracts:InputContract[]=[],public status=422){super(message);}
}
export function noteInputContract(version:string,source:{id:string;execution?:string},active:{id:string;workflowStep?:unknown;category?:unknown}[]):InputContract{
  // Security gates and procedure search also occupy the Ingest stage, but do not parse uploaded data.
  const ingestion=active.filter(c=>c.category==="Data ingestion"||["cap-wo-ingest","cap-csv-ingest"].includes(c.id));
  const unsupported=ingestion.filter(c=>!["cap-wo-ingest","cap-csv-ingest"].includes(c.id));
  const compatible=source.execution==="live"&&!unsupported.length;
  return {version,sourceSolutionId:source.id,ingestionCapabilityIds:ingestion.map(c=>c.id),
    supportedFormats:compatible?["txt","csv","json"]:[],expectedFields:NOTE_FIELDS,
    description:"Existing work-order note reader: one note per line, or id | date | site | equipment | note. CSV/JSON uploads normalize to this same text schema; no external connector is added.",
    compatible,reason:compatible?(ingestion.length?"Current ingestion executor uses the existing note reader.":"The current engine has no explicit ingestion block and uses its existing implicit note reader."):"No verified custom-input note reader exists for this source/selected ingestion. Catalog claims alone do not establish an executable adapter."};
}
export function fixedInputContract(recipe:string):InputContract{
  return {version:"combined",sourceSolutionId:recipe,ingestionCapabilityIds:[],supportedFormats:[],expectedFields:[],
    description:"This combined runtime consumes its fixed source-demo dataset; it has no custom file ingestion endpoint.",
    compatible:false,reason:`The ${recipe} combined case cannot ingest an uploaded file. Run its existing source demo, or implement and validate a source-specific ingestion adapter before using custom data. Renaming a file to CSV/JSON does not make it compatible.`};
}
function invalid(code:string,message:string,row?:number,field?:string):never{throw new WorkbenchInputError(message,[{code,message,...(row===undefined?{}:{row}),...(field?{field}:{})}],[],code==="too_large"?413:422);}
function csvRows(text:string):string[][]{
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false,closed=false;
  const pushCell=()=>{row.push(cell);cell="";closed=false;};
  const pushRow=()=>{pushCell();if(row.some(c=>c.trim()))rows.push(row);row=[];if(rows.length>INPUT_MAX_ROWS+1)invalid("too_many_rows",`Use at most ${INPUT_MAX_ROWS} records.`);};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)invalid("malformed_csv","CSV quotes must surround a whole field; escape inner quotes by doubling them.",rows.length+1);quoted=true;continue;}
    if(c===","){pushCell();continue;}
    if(c==="\n"){pushRow();continue;}
    if(c==="\r")continue;
    if(closed&&c.trim())invalid("malformed_csv","Unexpected text after a closing CSV quote.",rows.length+1);
    if(!closed)cell+=c;
  }
  if(quoted)invalid("malformed_csv","CSV contains an unclosed quoted field.",rows.length+1);
  if(cell||row.length||closed)pushRow();
  return rows;
}
function recordText(record:unknown,row:number):string{
  if(!record||typeof record!=="object"||Array.isArray(record))invalid("invalid_record","Each record must be an object with id, date, site, equipment and note string fields.",row);
  const r=record as Record<string,unknown>;
  for(const field of Object.keys(r))if(!NOTE_FIELDS.includes(field))invalid("unexpected_field",`Unsupported field '${field}'. Use only ${NOTE_FIELDS.join(", ")}; map source columns explicitly rather than silently discarding them.`,row,field);
  for(const field of NOTE_FIELDS){
    const value=r[field];
    if(typeof value!=="string"||(field!=="date"&&!value.trim()))invalid("required_field",`Provide '${field}' as ${field==="date"?"a YYYY-MM-DD string, or an empty string when unknown":"a nonempty string"}.`,row,field);
    if(/[\r\n|]/.test(value as string))invalid("unrepresentable_field",`'${field}' contains a line break or pipe separator that the existing note reader cannot preserve. Split notes into separate records; do not embed pipes.`,row,field);
  }
  const date=(r.date as string).trim();
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))invalid("invalid_date","Use a valid YYYY-MM-DD date, or an empty string when unknown.",row,"date");
  return NOTE_FIELDS.map(f=>(r[f] as string).trim()).join(" | ");
}
export function normalizeInput(text:string,format?:"txt"|"csv"|"json"):{text:string;format:string;recordCount:number}{
  if(Buffer.byteLength(text,"utf8")>INPUT_MAX_BYTES)invalid("too_large",`Input must be ${INPUT_MAX_BYTES/1024} KiB or smaller.`);
  text=text.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim();
  if(!text)invalid("empty","The input is empty. Supply at least one work-order note or record.");
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)||/^(%PDF-|PK\u0003|<\?xml|<!doctype\s+html|<html\b)/i.test(text))invalid("binary_or_document","Use UTF-8 plain notes, CSV or JSON; binary/PDF/Office/HTML/XML documents are not supported by this ingestion.");
  const header=text.split("\n",1)[0].split(",").map(s=>s.trim());
  const csvLike=header.length>1&&(header.includes("note")||(text.includes("\n")&&header.every(s=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(s))));
  const detected=format&&format!=="txt"?format:/^[{[]/.test(text)?"json":csvLike?"csv":"txt";
  let lines:string[];
  if(detected==="json"){
    let data:unknown;try{data=JSON.parse(text);}catch{invalid("malformed_json","Malformed JSON. Upload an array of records with id, date, site, equipment and note string fields.");}
    if(!Array.isArray(data))invalid("json_shape","JSON must be an array of work-order records, not an arbitrary object or invoice payload.");
    if(!data.length)invalid("empty","The JSON array contains no records.");
    if(data.length>INPUT_MAX_ROWS)invalid("too_many_rows",`Use at most ${INPUT_MAX_ROWS} records.`);
    lines=data.map((r,i)=>recordText(r,i+1));
  }else if(detected==="csv"){
    const rows=csvRows(text),header=rows.shift()?.map(s=>s.trim())??[];
    if(header.length!==NOTE_FIELDS.length||new Set(header).size!==header.length||NOTE_FIELDS.some(f=>!header.includes(f)))invalid("csv_header",`Expected CSV columns: ${NOTE_FIELDS.join(",")}. Map your source fields to this schema; invoice/financial tables are not work-order notes.`,1);
    if(!rows.length)invalid("empty","CSV has a header but no records.");
    lines=rows.map((r,i)=>{if(r.length!==header.length)invalid("csv_columns",`Expected ${header.length} fields; found ${r.length}. Quote values containing commas.`,i+2);return recordText(Object.fromEntries(header.map((f,j)=>[f,r[j]])),i+2);});
  }else{
    lines=text.split("\n").filter(s=>s.trim());
    if(lines.length>INPUT_MAX_ROWS)invalid("too_many_rows",`Use at most ${INPUT_MAX_ROWS} records.`);
    lines.forEach((line,i)=>{
      if(line.includes("|")){
        const fields=line.split("|");
        if(fields.length<5)invalid("text_columns","Pipe-delimited input requires id | date | site | equipment | note. Otherwise supply plain notes without separators.",i+1);
        recordText(Object.fromEntries(NOTE_FIELDS.map((f,j)=>[f,j===4?fields.slice(4).join(" / "):fields[j]])),i+1);
      }
    });
  }
  const normalized=lines.join("\n");
  if(Buffer.byteLength(normalized,"utf8")>INPUT_MAX_BYTES)invalid("too_large","Normalized records exceed 256 KiB; split the file into smaller batches.");
  return {text:normalized,format:detected,recordCount:lines.length};
}
export function validateEngineInput(text:string,contracts:InputContract[],format?:"txt"|"csv"|"json"){
  try{
    const incompatible=contracts.filter(c=>!c.compatible);
    if(incompatible.length)throw new WorkbenchInputError("Input is incompatible with the selected ingestion.",incompatible.map(c=>({code:"incompatible_ingestion",message:`${c.version}: ${c.reason}`})));
    return normalizeInput(text,format);
  }catch(error){if(error instanceof WorkbenchInputError)error.contracts=contracts;throw error;}
}
