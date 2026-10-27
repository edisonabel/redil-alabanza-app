import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';
const {outputFiles}=buildSync({entryPoints:['src/utils/liveDirectorEntryCount.ts'],bundle:true,write:false,format:'cjs',platform:'node'});const scope={module:{exports:{}},exports:{}};vm.runInNewContext(outputFiles[0].text,scope);
const {entryCountPlan:plan,entryCountAt:at,queueNumberFromKey:key,queueNumberShortcut:shortcut}=scope.module.exports;
const meter={numerator:4,denominator:4},uno=6.31578947368421,p=plan(76,meter,uno),step=60/76;
assert.equal(p.recorded,true);assert.equal(at(p,0),null);
for(let i=0;i<4;i++)assert.equal(at(p,uno-(4-i)*step+.001),i+1);
assert.equal(at(p,uno),'ENTRA');assert.equal(at(p,uno+.5),null);
assert.equal(plan(76,meter,0).recorded,false,'No recorded prelude means one added bar, not a guessed lyric offset');
assert.equal(plan(76,meter,.5).recorded,false);assert.equal(plan(0,meter,0),null);
const six=plan(120,{numerator:6,denominator:8},3);assert.equal(six.beatSeconds,.25);assert.equal(at(six,2.75),6);
const three=plan(90,{numerator:3,denominator:4},4);
for(let i=0;i<3;i++)assert.equal(at(three,4-(3-i)*60/90+.001),i+1);
assert.equal(at(three,4),'ENTRA');
for(let n=1;n<=10;n++){assert.equal(key(n===10?'0':String(n)),n);assert.equal(shortcut(n),n===10?'0':String(n));}
for(const other of ['P','R','E','F','B','S','ArrowLeft','!',''])assert.equal(key(other),null);
assert.equal(shortcut(11),undefined);
console.log('REAPER-aligned count, meter subdivisions, fallback bar and nonconflicting queue numbers: ok');
