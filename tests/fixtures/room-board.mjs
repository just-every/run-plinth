import { takeoffPlan } from './takeoff-plan.mjs'
export const roomPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64')
export const roomJpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAYABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBlFFFfPnshRRRQAUUUUAFFFFAH/9k=','base64')
export const roomObj=Buffer.from('# Synthetic measured room floor\nmtllib synthetic-plinth.mtl\nv 0 0 0\nv 4 0 0\nv 4 0 3\nv 0 0 3\nf 1 2 3 4\n')
export function roomGlb(){
 const positions=Buffer.alloc(48),indices=Buffer.alloc(12)
 ;[0,0,0,4,0,0,4,0,3,0,0,3].forEach((n,i)=>positions.writeFloatLE(n,i*4));[0,1,2,0,2,3].forEach((n,i)=>indices.writeUInt16LE(n,i*2))
 const binary=Buffer.concat([positions,indices]),doc={asset:{version:'2.0'},buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:48},{buffer:0,byteOffset:48,byteLength:12}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[0,0,0],max:[4,0,3]},{bufferView:1,componentType:5123,count:6,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0,translation:[2,0,0]}],scenes:[{nodes:[0]}],scene:0}
 let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)])
 const header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4)
 return Buffer.concat([header,jh,json,bh,binary])
}
export function roomIfc(kind='mesh'){
 const body=kind==='mesh'?"#20=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(4000.,0.,0.),(4000.,3000.,0.),(0.,3000.,0.)));\n#21=IFCTRIANGULATEDFACESET(#20,$,.F.,((1,2,3),(1,3,4)),$);":kind==='extrusion'?"#20=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,4000.,3000.);\n#22=IFCDIRECTION((0.,0.,1.));\n#21=IFCEXTRUDEDAREASOLID(#20,#2,#22,2700.);":"#21=IFCBOOLEANRESULT(.DIFFERENCE.,#2,#2);"
 return Buffer.from(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Synthetic measured room'),'2;1');
FILE_NAME('synthetic-plinth.ifc','2026-10-27T15:00:00',(),(),'Synthetic','Synthetic','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#2,$);
#4=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#5=IFCUNITASSIGNMENT((#4));
#6=IFCPROJECT('0000000000000000000001',$,'Synthetic room',$,$,$,$,(#3),#5);
#7=IFCCARTESIANPOINT((2000.,1000.,0.));
#8=IFCAXIS2PLACEMENT3D(#7,$,$);
#9=IFCLOCALPLACEMENT($,#8);
#10=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#3,$,.MODEL_VIEW.,$);
${body}
#23=IFCSHAPEREPRESENTATION(#10,'Body','Tessellation',(#21));
#24=IFCPRODUCTDEFINITIONSHAPE($,$,(#23));
#25=IFCBUILDINGELEMENTPROXY('0000000000000000000002',$,'Synthetic room',$,$,#9,#24,$,.NOTDEFINED.);
ENDSEC;
END-ISO-10303-21;
`)
}
export const roomFiles=()=>[{name:'synthetic-plinth-plan.pdf',bytes:takeoffPlan()},{name:'synthetic-plinth-finish.png',bytes:roomPng},{name:'synthetic-plinth-finish.jpg',bytes:roomJpeg},{name:'synthetic-plinth-room.glb',bytes:roomGlb()},{name:'synthetic-plinth-room.obj',bytes:roomObj},{name:'synthetic-plinth-room.ifc',bytes:roomIfc()},{name:'synthetic-plinth-extrusion.ifc',bytes:roomIfc('extrusion')}]
export const roomInput=()=>({title:'Kitchen finish board',measurements:{length:'4',width:'3',height:'2.7',unit:'m'},files:roomFiles().map(({name,bytes})=>({name,base64:bytes.toString('base64')}))})
