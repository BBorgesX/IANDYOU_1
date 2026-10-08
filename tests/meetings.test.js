import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingStore} from '../src/meetings.js';
const plan={destination:'Shopping da Bahia, Salvador',participants:[{name:'Bruno',origin:'Pituba',mode:'car'},{name:'Cleide',origin:'Centro',mode:'transit'}]};
const fixture=async({origin})=>({durationSeconds:origin==='Pituba'?2100:1200,source:'Google Maps',calculatedAt:1000000});

test('cria encontro com credenciais isoladas e comunica saída entre participantes',async()=>{
 let time=1000000;
 const calls=[];
 const store=createMeetingStore({now:()=>time,getRoute:async input=>{calls.push(input);return fixture(input);}});
 const created=await store.create(plan);
 assert.equal(created.routes[0].durationSeconds,2100);
 assert.equal(created.plan.participants[1].name,'Cleide');
 assert.equal(store.get(created.id,created.tokens[1]).viewer,1);
 assert.equal(store.get(created.id,created.tokens[1]).tokens,undefined);
 assert.throws(()=>store.get(created.id,'invalid'),e=>e.status===403);
 time+=120000;
 await store.depart(created.id,created.tokens[0]);
 const cleide=store.get(created.id,created.tokens[1]);
 assert.equal(cleide.departedAt[0],time);
 assert.equal(cleide.recommendedDepartureAt[1],time+900000);
 assert.equal(calls.length,5); // 2 na criação, 2 na saída, 1 no horário futuro de Cleide.
 assert.equal(calls[4].departureAt,time+900000);
 time+=900000;
 await store.depart(created.id,created.tokens[1]);
 const result=store.get(created.id,created.tokens[0]);
 assert.equal(result.status,'traveling');
 assert.equal(result.arrivalAt[0],result.arrivalAt[1]);
 const count=calls.length;
 await store.depart(created.id,created.tokens[1]);
 assert.equal(calls.length,count);
});
test('falha de rotas não registra saída e permite tentar de novo',async()=>{
 let error=false;
 const store=createMeetingStore({getRoute:async input=>{if(error)throw new Error('Google indisponível');return fixture(input);}});
 const m=await store.create(plan);
 error=true;
 await assert.rejects(()=>store.depart(m.id,m.tokens[0]));
 assert.deepEqual(store.get(m.id,m.tokens[1]).departedAt,[null,null]);
 error=false;
 await store.depart(m.id,m.tokens[0]);
 assert.equal(store.get(m.id,m.tokens[1]).status,'waiting');
});
test('encerrar é propagado e impede nova saída; sessão expira',async()=>{
 let time=1000000;
 const store=createMeetingStore({now:()=>time,getRoute:fixture});
 const m=await store.create(plan);
 store.end(m.id,m.tokens[1]);
 assert.equal(store.get(m.id,m.tokens[0]).status,'ended');
 await assert.rejects(()=>store.depart(m.id,m.tokens[0]),e=>e.status===409);
 time+=13*3600000;
 assert.throws(()=>store.get(m.id,m.tokens[0]),e=>e.status===404);
});
test('não permite encerrar durante uma consulta e depois ressuscitar a sessão',async()=>{
 let resolve, pending=false;
 const store=createMeetingStore({getRoute:async input=>{
  if(pending) await new Promise(r=>{resolve=r;});
  return fixture(input);
 }});
 const m=await store.create(plan);
 // Uma consulta única da segunda pessoa evita dois resolvers concorrentes.
 await store.depart(m.id,m.tokens[0]);
 pending=true;
 const departing=store.depart(m.id,m.tokens[1]);
 store.end(m.id,m.tokens[0]);
 resolve();
 await assert.rejects(()=>departing,e=>e.status===409);
 assert.equal(store.get(m.id,m.tokens[0]).status,'ended');
});
