// Isolate basic ground beside baseline minor streets. Choose real names
// whose shipping roll uses a baseline theme, with one in four rocky roads.
module.exports = function basicRoadLayers(ctx, roads, tx, ty, extent) {
  const names = roads.map((road, index) => {
    let name;
    for (let salt = 0; ; salt++) {
      if (salt > 10000) throw new Error('No baseline road sample found');
      name = `Coverage ${index} ${salt}`;
      const key = ctx.StreetVariants.streetKey(name, tx, ty);
      const variant = ctx.StreetVariants.variantFor(key, name, 'minor');
      const row = ctx.StreetVariants.VARIANT_BY_ID[variant];
      if (row?.baseline && (row.terrain === 'ROCK') === (index % 4 === 0)) break;
    }
    return { ...road, tags: {name}, geom: road.geom };
  });
  return [
    {name:'transportation',extent,features:roads.map(road => ({...road,tags:{...road.tags,class:'minor'}}))},
    {name:'transportation_name',extent,features:names},
  ];
};
