import { buildRegionAccommodations } from "../_accommodations";

const REGION = "himachal";
const CURRENCY = "INR";

const accommodations = buildRegionAccommodations({
  regionId: REGION,
  currency: CURRENCY,
  cities: [
    {
      nodeId: "node_shimla",
      name: "Shimla",
      regionId: REGION,
      lat: 31.1048,
      lng: 77.1734,
      theme: "Mall Road",
      baseNightlyRate: 2800,
    },
    {
      nodeId: "node_manali",
      name: "Manali",
      regionId: REGION,
      lat: 32.2432,
      lng: 77.1892,
      theme: "Solang",
      baseNightlyRate: 3100,
    },
    {
      nodeId: "node_dharamshala",
      name: "Dharamshala",
      regionId: REGION,
      lat: 32.219,
      lng: 76.3234,
      theme: "Dhauladhar",
      baseNightlyRate: 2500,
    },
    {
      nodeId: "node_dalhousie",
      name: "Dalhousie",
      regionId: REGION,
      lat: 32.5448,
      lng: 75.9712,
      theme: "Pine Crest",
      baseNightlyRate: 2200,
    },
    {
      nodeId: "node_kullu",
      name: "Kullu",
      regionId: REGION,
      lat: 31.9578,
      lng: 77.1093,
      theme: "Beas Valley",
      baseNightlyRate: 2200,
    },
    {
      nodeId: "node_kasol",
      name: "Kasol",
      regionId: REGION,
      lat: 32.0098,
      lng: 77.3149,
      theme: "Parvati",
      baseNightlyRate: 2100,
    },
    {
      nodeId: "node_khajjiar",
      name: "Khajjiar",
      regionId: REGION,
      lat: 32.5478,
      lng: 76.0566,
      theme: "Meadow",
      baseNightlyRate: 1900,
    },
    {
      nodeId: "node_bir",
      name: "Bir",
      regionId: REGION,
      lat: 32.029,
      lng: 76.725,
      theme: "Billing",
      baseNightlyRate: 2000,
    },
    {
      nodeId: "node_mandi",
      name: "Mandi",
      regionId: REGION,
      lat: 31.708,
      lng: 76.9322,
      theme: "Temple Town",
      baseNightlyRate: 1700,
    },
    {
      nodeId: "node_kaza",
      name: "Kaza",
      regionId: REGION,
      lat: 32.227,
      lng: 78.005,
      theme: "Spiti",
      baseNightlyRate: 2700,
    },
  ],
});

export default accommodations;
