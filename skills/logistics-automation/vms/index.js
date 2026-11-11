/**
 * VMS Service Catalog Module Entry Point
 * Exports all core VMS automation functions, specification builders, and config.
 */

const vmsConfig = require('./vms_config');
const vmsAuth = require('./vms_auth');
const locationResolver = require('./location_resolver');
const tariffBuilder = require('./tariff_builder');
const vmsSpecBuilder = require('./vms_spec_builder');
const catalogManager = require('./catalog_manager');
const catalogCache = require('./catalog_cache');
const routeManager = require('./route_manager');
const batchCatalogManager = require('./batch_catalog_manager');
const vmsMenu = require('./vms_menu');

module.exports = {
  ...vmsConfig,
  ...vmsAuth,
  ...locationResolver,
  ...tariffBuilder,
  ...vmsSpecBuilder,
  ...catalogManager,
  ...catalogCache,
  ...routeManager,
  ...batchCatalogManager,
  ...vmsMenu,
};
