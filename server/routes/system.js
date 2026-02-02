// routes/system.js
router.get('/modules', async (req, res) => {
  const manifests = moduleLoader.getManifests();
  const collectorStatus = collectorManager.getStatus();
  const routes = routeManager.getRegisteredRoutes();
  
  res.json({
    modules: manifests.map(m => ({
      ...m,
      collectorStatus: collectorStatus[m.id],
      routes: routes.find(r => r.moduleId === m.id)
    }))
  });
});