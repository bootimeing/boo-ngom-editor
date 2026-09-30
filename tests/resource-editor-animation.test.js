const assert=require('node:assert/strict'),path=require('node:path'),zlib=require('node:zlib');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
const {encodeResourceApng,animationBounds}=require(path.join(runtime,'out/resource-editor/animation'));
const {crc32}=require(path.join(runtime,'out/utils/pak-reader'));
const image=(width,height,alpha)=>({width,height,rgba:new Uint8ClampedArray(width*height*4).map((_,i)=>i%4===3?alpha:i%4===0?71:103)});
const frames=[{image:image(3,4,117),x:-5,y:7},{image:image(4,3,255),x:1,y:-2},{image:image(1,1,0),x:0,y:0}];
const bounds=animationBounds(frames);assert.deepEqual(bounds,{left:-5,top:-2,width:10,height:13});
const png=encodeResourceApng(frames,13),decoded=[];let current,seq=0;
for(let at=8;at<png.length;){
 const length=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8),data=png.subarray(at+8,at+8+length);
 assert.equal(crc32(png.subarray(at+4,at+8+length)),png.readUInt32BE(at+8+length),'independent CRC');
 if(type==='acTL')assert.equal(data.readUInt32BE(0),3);
 if(type==='fcTL'){
  assert.equal(data.readUInt32BE(),seq++);assert.equal(data.readUInt32BE(4),bounds.width);assert.equal(data.readUInt32BE(8),bounds.height);
  assert.equal(data.readUInt16BE(20),1);assert.equal(data.readUInt16BE(22),13);assert.equal(data[25],0,'source blend clears prior image');
  current=[];decoded.push(current);
 }
 if(type==='IDAT')current.push(data);
 if(type==='fdAT'){assert.equal(data.readUInt32BE(),seq++);current.push(data.subarray(4));}
 at+=length+12;
}
assert.equal(decoded.length,frames.length);
// Independent PNG unfilter oracle, including filters chosen by production encoder.
for(let i=0;i<decoded.length;i++){
 const raw=zlib.inflateSync(Buffer.concat(decoded[i])),stride=bounds.width*4,pixels=Buffer.alloc(stride*bounds.height);
 const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
 for(let y=0;y<bounds.height;y++)for(let x=0;x<stride;x++){
  const type=raw[y*(stride+1)],l=x>=4?pixels[y*stride+x-4]:0,u=y?pixels[(y-1)*stride+x]:0,ul=y&&x>=4?pixels[(y-1)*stride+x-4]:0;
  pixels[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,l,u,(l+u)>>1,paeth(l,u,ul)][type])&255;
 }
 const f=frames[i];
 for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++){
  const sx=x+bounds.left-f.x,sy=y+bounds.top-f.y;
  const expected=sx>=0&&sy>=0&&sx<f.image.width&&sy<f.image.height?Buffer.from(f.image.rgba.slice((sy*f.image.width+sx)*4,(sy*f.image.width+sx+1)*4)):Buffer.alloc(4);
  assert.deepEqual(pixels.subarray((y*bounds.width+x)*4,(y*bounds.width+x+1)*4),expected);
 }
}
assert.throws(()=>encodeResourceApng(frames,0),/INVALID_FPS/);
assert.throws(()=>encodeResourceApng([{image:image(3,3,255),x:32767,y:0}],60),/ANIMATION_MEMORY_LIMIT/);
assert.throws(()=>animationBounds(Array(257).fill(frames[0])),/BATCH_LIMIT/);
console.log('Resource animation PASS: independent CRC/chunk sequencing/timing/all-frame RGBA/origin/empty-frame checks, bounded memory');
