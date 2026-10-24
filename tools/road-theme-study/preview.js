const canvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
function groundTile() {
  const c=canvas(32,32),g=c.getContext('2d');g.imageSmoothingEnabled=false;
  const type=document.getElementById('ground').value;
  if(type==='grass') {const columns=grass.width/16;g.drawImage(grass,31%columns*16,Math.floor(31/columns)*16,16,16,0,0,32,32);}
  else drawSelectedMaterial(g,32,type==='sand'?'G10':'G04');
  return c;
}
function themeColor(id,restored) {
  const color=CHOICES[id].color;
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  if(restored||id==='burned')return rgb;
  const light=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  return rgb.map(channel=>light+(channel-light)*.35);
}
function preview(row,proposed) {
  const c=canvas(420,178),g=c.getContext('2d');g.imageSmoothingEnabled=false;
  g.fillStyle=g.createPattern(groundTile(),'repeat');g.fillRect(0,0,c.width,c.height);
  const restored=document.getElementById('restored').checked;
  const tile=RoadOverlay.selectedRoadTile(row.id,restored);
  g.strokeStyle=g.createPattern(tile,'repeat');g.lineWidth=64;g.lineJoin=g.lineCap='round';g.beginPath();
  for(let x=-30;x<=450;x+=5){const y=89+22*Math.sin(x/105);if(x===-30)g.moveTo(x,y);else g.lineTo(x,y);}
  g.stroke();return c;
}
function render() {
  const host=document.getElementById('cards');host.replaceChildren();const search=document.getElementById('search').value.toLowerCase();
  const rows=[{id:'plain',title:'Ordinary road / path'},{id:'suppressed',title:'Suppressed roads'},...StreetVariants.STREET_VARIANTS];
  let count=0;
  for(const row of rows){const spec=CHOICES[row.id];if(!spec)throw Error('Missing proposal: '+row.id);
    if(!(row.title+' '+row.id+' '+spec.props+' '+spec.palette).toLowerCase().includes(search))continue;
    const a=document.createElement('article');a.id=row.id;
    const artId=row.art||row.story||(row.id==='plain'?'street_scenic':null);const art=ART[artId];
    const color='#'+themeColor(row.id,document.getElementById('restored').checked).map(c=>Math.round(c).toString(16).padStart(2,'0')).join('');
    a.innerHTML='<h2>'+row.title+'</h2><div class="swatches"><i class="chip" style="background:'+color+'"></i>'+spec.palette+' · '+color+'</div>';
    if(art){const ref=document.createElement('div');ref.className='ref';const img=document.createElement('img');img.src=art;img.alt=row.title+' reference painting';const text=document.createElement('span');text.textContent='Reference: '+artId.replace('street_','').replaceAll('_',' ')+(row.art&&row.art!==row.story?' (shared art)':'');ref.append(img,text);a.append(ref);}
    for(const [text,proposed] of [['Applied two-tone colour · '+(row.id==='burned'?'solid ember surface':document.getElementById('restored').checked?'restored':'muted unrestored'),true]]){const l=document.createElement('span');l.className='caption';l.textContent=text;a.append(l,preview(row,proposed));}
    const props=document.createElement('p');props.innerHTML='<strong>Existing cues:</strong> '+spec.props;const why=document.createElement('p');why.textContent=spec.reason;a.append(props,why);host.append(a);count++;
  }
  document.getElementById('count').textContent=count+' routes';
}
Promise.all([atlas.decode(),grass.decode()]).then(()=>{render();for(const id of ['search','ground','restored'])document.getElementById(id).addEventListener('input',render);window.catalogueReady=true;}).catch(e=>{document.getElementById('error').textContent=e.message;throw e;});
