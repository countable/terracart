// Exact generated quarry ownership: coloured cells and boundaries, not a hull.
(function (root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create({map,toLL,getEdge,toggle,summary,onSelect}) {
    const pane=map.createPane('quarryReview'); pane.style.zIndex=410;
    const renderer=L.canvas({pane:'quarryReview'}), layer=L.layerGroup();
    let sites=new Map(), world;
    const color=id=>`hsl(${fnv1a(id)%360},80%,62%)`;
    function sync(){if(toggle.checked)layer.addTo(map);else map.removeLayer(layer);summary.hidden=!toggle.checked;}
    function update(next,reviews) {
      world=next; sites=new Map(); layer.clearLayers();const edge=getEdge();let sliverCount=0;
      for(const entry of world.tiles){
        const N=entry.cellsPerEdge,coverage=entry.zone?.coverage;if(!coverage)continue;
        const canvas=document.createElement('canvas');canvas.width=canvas.height=N;const ctx=canvas.getContext('2d');
        const local=new Map();
        for(let i=0;i<coverage.length;i++){
          const a=entry.zone.anchors[coverage[i]-1];if(a?.kind!=='quarry')continue;
          const id=ZoneReview.key(a),x=i%N,y=Math.floor(i/N);
          let site=sites.get(id);if(!site){site={id,review:reviews.get(id),cells:0,area:0,fragments:0};sites.set(id,site);}
          site.cells++;site.area+=WorldGen.CELL_M**2;
          let part=local.get(id);if(!part){part={site,slot:coverage[i],edges:[],cells:new Set(),anchor:a};local.set(id,part);}
          part.cells.add(i);ctx.fillStyle=color(id);ctx.fillRect(x,y,1,1);
          const ll=(px,py)=>toLL((entry.tx+px/N)*edge,(entry.ty+py/N)*edge,edge);
          for(const [dx,dy,points]of [[0,-1,[[x,y],[x+1,y]]],[1,0,[[x+1,y],[x+1,y+1]]],[0,1,[[x+1,y+1],[x,y+1]]],[-1,0,[[x,y+1],[x,y]]]]){
            const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=N||ny>=N||coverage[ny*N+nx]!==coverage[i])part.edges.push(points.map(([px,py])=>ll(px,py)));
          }
        }
        const slivers=entry.zone.quarrySlivers || [];
        for(const sliver of slivers){
          sliverCount++;const cells=new Set(sliver.cells),edges=[];
          const ll=(x,y)=>toLL((entry.tx+x/N)*edge,(entry.ty+y/N)*edge,edge);
          for(const i of cells){const x=i%N,y=Math.floor(i/N);ctx.fillStyle='#aaa';ctx.fillRect(x,y,1,1);
            for(const [dx,dy,points]of [[0,-1,[[x,y],[x+1,y]]],[1,0,[[x+1,y],[x+1,y+1]]],[0,1,[[x+1,y+1],[x,y+1]]],[-1,0,[[x,y+1],[x,y]]]]){
              const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=N||ny>=N||!cells.has(ny*N+nx))edges.push(points.map(([x,y])=>ll(x,y)));
            }
          }
          L.polyline(edges,{renderer,pane:'quarryReview',color:'#aaa',weight:1.5,dashArray:'2 4',bubblingMouseEvents:false})
            .bindTooltip(`Small fragment omitted: ${cells.size} cells`).on('click',ev=>showSliver(sliver,ev.latlng)).addTo(layer);
        }
        if(!local.size&&!slivers.length)continue;
        L.imageOverlay(canvas.toDataURL(),[toLL(entry.tx*edge,(entry.ty+1)*edge,edge),toLL((entry.tx+1)*edge,entry.ty*edge,edge)],{pane:'quarryReview',opacity:.2}).addTo(layer);
        for(const {site,edges,cells,anchor}of local.values()){
          const unseen=new Set(cells);
          while(unseen.size){site.fragments++;const queue=[unseen.values().next().value];unseen.delete(queue[0]);for(let h=0;h<queue.length;h++){
            const i=queue[h],x=i%N,y=Math.floor(i/N);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=ny*N+nx;if(nx>=0&&ny>=0&&nx<N&&ny<N&&unseen.delete(j))queue.push(j);}
          }}
          L.polyline(edges,{renderer,pane:'quarryReview',color:color(site.id),weight:2,opacity:1,dashArray:anchor.clipped?'5 4':null,bubblingMouseEvents:false})
            .bindTooltip(()=>`${site.review?.name || 'Quarry'} · ${(site.area/10000).toFixed(2)} ha`)
            .on('click',ev=>inspect(site,ev.latlng)).addTo(layer);
        }
      }
      const values=[...sites.values()],small=values.filter(s=>s.area<1000).length,large=values.filter(s=>s.area>=10000).length;
      summary.textContent=`${values.length} quarry records · ${small} under 0.1 ha · ${large} at least 1 ha. ${sliverCount} small fragments omitted (gray). Colours identify clusters; dashed coloured boundaries mark incomplete tile-edge sites. Click coloured ground for details.`;
      sync();
    }
    function showSliver(sliver,ll){L.popup().setLatLng(ll).setContent(`<b>Small fragment omitted</b><br>${sliver.cells.length} usable cells — below the ${ZoneVariantData.quarryLayouts.minSiteCells}-cell minimum.<br>Ordinary ground; no quarry name or finite reward budget.`).openOn(map);}
    function inspect(site,ll){
      const z=site.review;if(!z)return;
      onSelect(site.id);
      L.popup().setLatLng(ll).setContent(`<b>${esc(z.name || 'Quarry')}</b><br>${esc(z.variant.name)}<br>${site.cells} cells · ${(site.area/10000).toFixed(2)} ha<br>${site.fragments} connected ground piece${site.fragments===1?'':'s'}`
        +(z.anchor.cluster?`<br>${z.anchor.cluster.sourceCells} lane-buffer cells + ${z.anchor.cluster.filledCells} filled-gap cells`:'')
        +`<br>Finds ${z.finds.join('/')} · finite guards ${z.guards.join('/')}`
        +(z.anchor.clipped?'<hr>Incomplete source at a tile edge; displayed area is only the loaded fragment.':'')
        +'<hr>Coverage respects buildings, retained roads, protected ground and other nexus sites.').openOn(map);
    }
    map.on('click',ev=>{
      if(!toggle.checked||!world||document.getElementById('placeHome')?.classList.contains('on'))return;
      for(const entry of world.tiles){const N=entry.cellsPerEdge;const lng=ev.latlng.lng,lat=ev.latlng.lat*Math.PI/180;
        const gx=(lng+180)/360*(1<<WorldGen.Z),gy=(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*(1<<WorldGen.Z);
        const x=Math.floor((gx-entry.tx)*N),y=Math.floor((gy-entry.ty)*N);if(x<0||y<0||x>=N||y>=N)continue;
        const a=entry.zone?.anchors[(entry.zone.coverage?.[y*N+x]||0)-1],site=a&&sites.get(ZoneReview.key(a));if(site)inspect(site,ev.latlng);else {const sliver=entry.zone?.quarrySlivers?.find(s=>s.cells.includes(y*N+x));if(sliver)showSliver(sliver,ev.latlng);}break;
      }
    });
    toggle.onchange=sync;
    return {update,layer,get sites(){return sites;}};
  }
  root.MapReviewQuarries={create};
})(window);
