// Isolate basic ground beside ordinary minor streets. Choose real street names
// whose shipping roll is plain, with one in four roads rock-lined. The
// one-road art sample intentionally shows a rock-lined example.
module.exports = function basicRoadLayers(ctx, roads, tx, ty, extent) {
  const names = roads.map((road, index) => {
    let name;
    for (let salt = 0; ; salt++) {
      if (salt > 10000) throw new Error('No plain road sample found');
      name = `Coverage ${index} ${salt}`;
      const key = ctx.StreetVariants.streetKey(name, tx, ty);
      if (!ctx.StreetVariants.variantFor(key, name, 'minor')
          && ctx.StreetVariants.rocksFor(key, 'minor', null) === (index % 4 === 0)) break;
    }
    return { ...road, tags: {name}, geom: road.geom };
  });
  return [
    {name:'transportation',extent,features:roads.map(road => ({...road,tags:{...road.tags,class:'minor'}}))},
    {name:'transportation_name',extent,features:names},
  ];
};
