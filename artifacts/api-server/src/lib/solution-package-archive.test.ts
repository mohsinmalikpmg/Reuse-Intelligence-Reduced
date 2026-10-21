import test from "node:test";
import assert from "node:assert/strict";
import { inspectSolutionArchive, validateEntry, MAX_ARCHIVE } from "./solution-package-archive";

// Minimal stored ZIP fixtures, built in memory; no fixture code is executed.
function zip(entries: {name:string;body?:string;mode?:number;flags?:number}[]) {
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const e of entries){
    const name=Buffer.from(e.name),body=Buffer.from(e.body??"hello");
    let crc=0xffffffff;
    for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(e.flags??0,6);
    l.writeUInt32LE(crc,14);l.writeUInt32LE(body.length,18);l.writeUInt32LE(body.length,22);l.writeUInt16LE(name.length,26);
    local.push(l,name,body);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(e.flags??0,8);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(name.length,28);
    c.writeUInt32LE(((e.mode??0x81a4)<<16)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,name);offset+=l.length+name.length+body.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
test("safe source package hashes files and statically reads dependencies",async()=>{
  const result=await inspectSolutionArchive(zip([{name:"src/main.ts"},{name:"package.json",body:'{"dependencies":{"express":"5.0.0"}}'}]));
  assert.equal(result.files.length,2);assert.match(result.files[0].sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(result.dependencies,[{name:"express",version:"5.0.0",source:"package.json"}]);
});
test("rejects traversal, absolute paths, Windows paths, links, encryption and nested suffixes",()=>{
  for(const path of ["../a","/a","a/../b","C:/a","a\\b","a.zip","a.tar.gz","a\u0000b"]) assert.throws(()=>validateEntry(path,0x81a4,0));
  assert.throws(()=>validateEntry("link",0xa1ff,0));
  assert.throws(()=>validateEntry("secret",0x81a4,1));
});
test("rejects duplicate and case-colliding paths",async()=>{
  await assert.rejects(inspectSolutionArchive(zip([{name:"a.ts"},{name:"A.ts"}])),/Duplicate/);
});
test("rejects disguised nested archives",async()=>{
  await assert.rejects(inspectSolutionArchive(zip([{name:"image.bin",body:"PK\u0003\u0004content"}])),/Nested/);
});
test("rejects malformed and oversized archives",async()=>{
  await assert.rejects(inspectSolutionArchive(Buffer.from("not zip")));
  await assert.rejects(inspectSolutionArchive(Buffer.alloc(MAX_ARCHIVE+1)));
});
test("rejects symlinks, encryption and excess file count through ZIP parser",async()=>{
  await assert.rejects(inspectSolutionArchive(zip([{name:"link",mode:0xa1ff}])),/links/);
  // yauzl may reject the malformed encrypted fixture before our encryption guard.
  await assert.rejects(inspectSolutionArchive(zip([{name:"secret",flags:1}])));
  await assert.rejects(inspectSolutionArchive(zip(Array.from({length:501},(_,i)=>({name:`f${i}`})))),/500/);
});
test("rejects files over expanded per-file budget",async()=>{
  await assert.rejects(inspectSolutionArchive(zip([{name:"large.txt",body:"a".repeat(5*1024*1024+1)}])),/expansion/);
});
test("rejects high-ratio expansion metadata before opening a stream",async()=>{
  const data=zip([{name:"bomb.txt",body:"abc"}]);
  const central=data.indexOf(Buffer.from("504b0102","hex"));
  // Pretend this tiny payload is deflated and expands 1000-fold.
  data.writeUInt16LE(8,8);data.writeUInt32LE(3000,22);
  data.writeUInt16LE(8,central+10);data.writeUInt32LE(3000,central+24);
  await assert.rejects(inspectSolutionArchive(data),/expansion/);
});
