import { buildRegionAccommodations } from "../_accommodations";

const REGION = "rajasthan";
const CURRENCY = "INR";

const accommodations = buildRegionAccommodations({
  regionId: REGION,
  currency: CURRENCY,
  cities: [
    {
      nodeId: "node_jaipur",
      name: "Jaipur",
      regionId: REGION,
      lat: 26.9124,
      lng: 75.7873,
      theme: "Pink City",
      baseNightlyRate: 2600,
    },
    {
      nodeId: "node_udaipur",
      name: "Udaipur",
      regionId: REGION,
      lat: 24.5854,
      lng: 73.7125,
      theme: "Lake Palace",
      baseNightlyRate: 3200,
    },
    {
      nodeId: "node_jodhpur",
      name: "Jodhpur",
      regionId: REGION,
      lat: 26.2389,
      lng: 73.0243,
      theme: "Blue Fort",
      baseNightlyRate: 2500,
    },
    {
      nodeId: "node_jaisalmer",
      name: "Jaisalmer",
      regionId: REGION,
      lat: 26.9157,
      lng: 70.9083,
      theme: "Golden Dunes",
      baseNightlyRate: 2400,
    },
    {
      nodeId: "node_pushkar",
      name: "Pushkar",
      regionId: REGION,
      lat: 26.4899,
      lng: 74.5511,
      theme: "Sacred Lake",
      baseNightlyRate: 1800,
    },
    {
      nodeId: "node_ajmer",
      name: "Ajmer",
      regionId: REGION,
      lat: 26.4499,
      lng: 74.6399,
      theme: "Dargah Court",
      baseNightlyRate: 1700,
    },
    {
      nodeId: "node_mount_abu",
      name: "Mount Abu",
      regionId: REGION,
      lat: 24.5926,
      lng: 72.7156,
      theme: "Nakki",
      baseNightlyRate: 2300,
    },
    {
      nodeId: "node_bikaner",
      name: "Bikaner",
      regionId: REGION,
      lat: 28.0229,
      lng: 73.3119,
      theme: "Desert Fort",
      baseNightlyRate: 2000,
    },
    {
      nodeId: "node_chittorgarh",
      name: "Chittorgarh",
      regionId: REGION,
      lat: 24.8887,
      lng: 74.6269,
      theme: "Vijay Stambh",
      baseNightlyRate: 1800,
    },
    {
      nodeId: "node_ranthambore",
      name: "Ranthambore",
      regionId: REGION,
      lat: 26.0173,
      lng: 76.5026,
      theme: "Tiger Trail",
      baseNightlyRate: 3100,
    },
  ],
});

export default accommodations;
