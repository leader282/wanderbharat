import { buildRegionAccommodations } from "../_accommodations";

const REGION = "gujarat";
const CURRENCY = "INR";

const accommodations = buildRegionAccommodations({
  regionId: REGION,
  currency: CURRENCY,
  cities: [
    {
      nodeId: "node_ahmedabad",
      name: "Ahmedabad",
      regionId: REGION,
      lat: 23.0225,
      lng: 72.5714,
      theme: "Sabarmati",
      baseNightlyRate: 2400,
    },
    {
      nodeId: "node_vadodara",
      name: "Vadodara",
      regionId: REGION,
      lat: 22.3072,
      lng: 73.1812,
      theme: "Gaekwad",
      baseNightlyRate: 2100,
    },
    {
      nodeId: "node_surat",
      name: "Surat",
      regionId: REGION,
      lat: 21.1702,
      lng: 72.8311,
      theme: "Tapi",
      baseNightlyRate: 2200,
    },
    {
      nodeId: "node_rajkot",
      name: "Rajkot",
      regionId: REGION,
      lat: 22.3039,
      lng: 70.8022,
      theme: "Kathiawar",
      baseNightlyRate: 1800,
    },
    {
      nodeId: "node_bhuj",
      name: "Bhuj",
      regionId: REGION,
      lat: 23.253,
      lng: 69.6693,
      theme: "White Rann",
      baseNightlyRate: 2400,
    },
    {
      nodeId: "node_dwarka",
      name: "Dwarka",
      regionId: REGION,
      lat: 22.2394,
      lng: 68.9678,
      theme: "Krishna Coast",
      baseNightlyRate: 1900,
    },
    {
      nodeId: "node_somnath",
      name: "Somnath",
      regionId: REGION,
      lat: 20.888,
      lng: 70.4017,
      theme: "Temple Shore",
      baseNightlyRate: 1800,
    },
    {
      nodeId: "node_junagadh",
      name: "Junagadh",
      regionId: REGION,
      lat: 21.5222,
      lng: 70.4579,
      theme: "Girnar",
      baseNightlyRate: 1800,
    },
    {
      nodeId: "node_sasan_gir",
      name: "Sasan Gir",
      regionId: REGION,
      lat: 21.1352,
      lng: 70.6066,
      theme: "Lion Trail",
      baseNightlyRate: 3200,
    },
    {
      nodeId: "node_kevadia",
      name: "Kevadia",
      regionId: REGION,
      lat: 21.838,
      lng: 73.7191,
      theme: "Unity Valley",
      baseNightlyRate: 2500,
    },
  ],
});

export default accommodations;
