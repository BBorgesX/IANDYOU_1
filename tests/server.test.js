import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.js';
import {createGoogleRoutes} from '../src/services/google-routes.js';
const input={destination:'Shopping',participants:[{name:'Bruno',origin:'Pituba',mode:'car'},{name:'Cleide',origin:'Centro',mode:'transit'}]};
const headers={'Content-Type':'application/json','X-Meetsync-Client':'1'};

test('HTTP: convite recebe saída em outro cliente e segredo não vaza',async t=>{
 const server=createServer({configured:true,getRoute:async({origin})=>({durationSeconds:origin==='Pituba'?2100:1200,source:'Google Maps'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const createdResponse=await fetch(base+'/api/meetings',{method:'POST',headers,body:JSON.stringify(input)});
 assert.equal(createdResponse.status,201);
 const created=await createdResponse.json();
 const bruno={'X-Meeting-Token':created.tokens[0]},cleide={'X-Meeting-Token':created.tokens[1]};
 const denied=await fetch(base+`/api/meetings/${created.id}`);
 assert.equal(denied.status,403);
 const departed=await fetch(base+`/api/meetings/${created.id}/depart`,{method:'POST',headers:{...headers,...bruno},body:'{}'});
 assert.equal(departed.status,200);
 const result=await(await fetch(base+`/api/meetings/${created.id}`,{headers:cleide})).json();
 assert.equal(result.status,'waiting');
 assert.ok(result.departedAt[0]);
 assert.equal(result.recommendedDepartureAt[1]-result.departedAt[0],900000);
 assert.equal(result.tokens,undefined);
 const evil=await fetch(base+'/api/meetings',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(input)});
 assert.equal(evil.status,403);
});
test('sem chave, responde erro acionável em vez de dados simulados',async t=>{
 // Força uma chave ausente mesmo quando existe uma chave real no ambiente.
 const server=createServer({configured:false,getRoute:createGoogleRoutes({apiKey:'',fetchImpl:async()=>{throw new Error('O teste não pode consultar o Google.');}})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/meetings`,{method:'POST',headers,body:JSON.stringify(input)});
 assert.equal(response.status,503);
 assert.match((await response.json()).error,/GOOGLE_MAPS_API_KEY/);
});
