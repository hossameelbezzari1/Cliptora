const assert=require('node:assert/strict')
const test=require('node:test')
const fs=require('node:fs')
const Module=require('node:module')
const ts=require('typescript')
function load(file){
 const source=fs.readFileSync(require('node:path').join(__dirname,'../src/lib',file),'utf8')
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const m={exports:{}}
 new Function('module','exports','require',out)(m,m.exports,require)
 return m.exports
}
const {animations,effects}=load('catalog.ts')
const {evaluateExpression,interpolateVariables}=load('variables.ts')
const {repeatOccurrences}=load('repeat.ts')
test('catalog contains exactly 30 animations and 50 effects',()=>{assert.equal(animations.length,30);assert.equal(effects.length,50)})
test('typed expressions and clock offsets',()=>{
 const clock=new Date('2026-10-21T10:00:00.000Z')
 assert.equal(evaluateExpression('now() + 1h',{}, {}, clock),'2026-10-21T11:00:00.000Z')
 assert.equal(interpolateVariables('Hello {{project.title}}',{}, {'project.title':'Clip'},clock),'Hello Clip')
})
test('linked repeat follows target end and movement',()=>{
 const source={id:'a',start:0,duration:4},target={id:'b',start:30,duration:62}
 const repeat={mode:'interval',interval:20,offset:0,until:'target_end',targetId:'b'}
 assert.deepEqual(repeatOccurrences(source,repeat,[source,target],120).map(o=>o.start),[30,50,70,90])
})
test('counted repeats extend past initial project duration',()=>{
 const rules={mode:'interval',interval:20,offset:0,until:'count',count:10}
 const future=repeatOccurrences({id:'count',start:0,duration:4},rules,[],60)
 assert.equal(future.length,10)
 assert.equal(future[9].start,180)
 const {effectiveTimelineEnd}=load('repeat.ts')
 assert.equal(effectiveTimelineEnd([{client_id:'count',start:0,duration:4,props:{repeat:rules}}]),184)
})
