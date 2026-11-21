import { LatheGeometry, Vector2 } from "three";
import { writeFileSync } from "node:fs";
const body = new LatheGeometry([
  [0,-74],[34,-74],[45,-68],[48,-63],[49,34],[46,58],[34,72],[31,76],[30,91],[28,95],[0,95]
].map(([x,y])=>new Vector2(x,y)),12);
const data = [];
const accessors = [];
const bufferViews = [];
let offset = 0;
function add(values, componentType, type, count, bounds={}) {
  const buffer = Buffer.from(values.buffer,values.byteOffset,values.byteLength);
  data.push(buffer,Buffer.alloc((4-buffer.length%4)%4));
  bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length});
  offset += buffer.length + (4-buffer.length%4)%4;
  accessors.push({bufferView:bufferViews.length-1,componentType,type,count,...bounds});
  return accessors.length-1;
}
body.computeBoundingBox();
const positions = add(body.attributes.position.array,5126,"VEC3",body.attributes.position.count,{min:body.boundingBox.min.toArray(),max:body.boundingBox.max.toArray()});
const normals = add(body.attributes.normal.array,5126,"VEC3",body.attributes.normal.count);
const indices = add(body.index.array,5123,"SCALAR",body.index.count);
const time = add(new Float32Array([0,1]),5126,"SCALAR",2,{min:[0],max:[1]});
const rotation = add(new Float32Array([0,0,0,1,0,Math.sin(Math.PI/3),0,Math.cos(Math.PI/3)]),5126,"VEC4",2);
const gltf = { asset:{version:"2.0",generator:"Velora product orbit fixture"}, scene:0,
  scenes:[{nodes:[0]}],nodes:[{mesh:0,name:"Finish"}],meshes:[{primitives:[{attributes:{POSITION:positions,NORMAL:normals},indices,material:0}]}],
  materials:[{pbrMetallicRoughness:{baseColorFactor:[.07,.38,.55,1],metallicFactor:.58,roughnessFactor:.22}}],
  animations:[{name:"Turn",samplers:[{input:time,output:rotation,interpolation:"LINEAR"}],channels:[{sampler:0,target:{node:0,path:"rotation"}}]}],
  accessors,bufferViews,buffers:[{byteLength:offset}] };
const json = Buffer.from(JSON.stringify(gltf));
const jsonBody = Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const binBody = Buffer.concat(data);
const header = Buffer.alloc(12);
header.write("glTF");header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonBody.length+binBody.length,8);
const chunk = (body,type) => {const h=Buffer.alloc(8);h.writeUInt32LE(body.length);h.writeUInt32LE(type,4);return Buffer.concat([h,body]);};
writeFileSync(new URL("../src/velora/scenes/product-orbit.glb",import.meta.url),Buffer.concat([header,chunk(jsonBody,0x4e4f534a),chunk(binBody,0x004e4942)]));
