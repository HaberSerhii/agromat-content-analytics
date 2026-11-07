import test from 'node:test';
import assert from 'node:assert/strict';
import { chartCurveSegments } from '../src/lib/chart-curve.ts';
test('curves pass through source observations and preserve gaps and single points', () => {
 const segments=chartCurveSegments([{x:0,y:10},{x:1,y:20},null,{x:3,y:5},null,{x:5,y:8},{x:6,y:4}]);
 assert.equal(segments.length,3);
 assert.equal(segments[0].line.startsWith('M0,10 C'),true);
 assert.equal(segments[0].line.endsWith('1,20'),true);
 assert.equal(segments[1].line,'M3,5');
 assert.equal(chartCurveSegments([]).length,0);
});
test('smoothed curves stay between real values even around sharp peaks and zero observations', () => {
 const points=[{x:0,y:50},{x:1,y:0},{x:2,y:100},{x:4,y:5},{x:5,y:5},{x:8,y:60}];
 const line=chartCurveSegments(points)[0].line;
 const cubics=line.split(' C').slice(1).map(part=>part.split(/[ ,]+/).map(Number));
 for(let i=0;i<cubics.length;i++){
  const [,c1,,c2,,end]=cubics[i],start=points[i].y;
  for(let step=0;step<=100;step++){
   const t=step/100,s=1-t,y=s*s*s*start+3*s*s*t*c1+3*s*t*t*c2+t*t*t*end;
   assert.ok(y>=Math.min(start,end)-1e-8&&y<=Math.max(start,end)+1e-8);
  }
 }
});
