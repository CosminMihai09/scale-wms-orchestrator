const SCALE_SHIPMENT_HEADERS_GET =
  /\/ilsintegrationservices\/scaleapi\/ShipmentHeadersApi\/Get\/?$/i;

const QUERY_SHIPMENT_BY_ID_WAREHOUSE = "ShipmentHeader.by.ShipmentId.and.Warehouse";

function isScaleShipmentHeadersGet(payload) {
  return (
    String(payload.method || "").toUpperCase() === "GET" &&
    SCALE_SHIPMENT_HEADERS_GET.test(payload.path || "")
  );
}

function getShipmentHeadersParams(payload) {
  const query = payload.query || {};
  const shipmentId = query.shipmentId || query.shipmentID;
  const warehouse = query.warehouse;
  if (!shipmentId || !warehouse) {
    return {
      error: "Missing required query parameters: shipmentId and warehouse",
    };
  }
  return {
    params: {
      shipmentID: String(shipmentId),
      warehouse: String(warehouse),
    },
  };
}

module.exports = {
  SCALE_SHIPMENT_HEADERS_GET,
  QUERY_SHIPMENT_BY_ID_WAREHOUSE,
  isScaleShipmentHeadersGet,
  getShipmentHeadersParams,
};
