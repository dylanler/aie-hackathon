import type { VendorLink } from "./types";

export const VENDORS = {
  craftcloudUpload: "https://craftcloud3d.com/en/upload",
  craftcloudOffer: (offerId: string) => `https://craftcloud3d.com/en/offer/${offerId}`,
  craftcloudConfiguration: (configurationId: string) => `https://craftcloud3d.com/configuration/${configurationId}`,
  oshCutApp: "https://app.oshcut.com",
  oshCutCart: (orderGuid: string) => `https://app.oshcut.com/cart/${orderGuid}`,
  fabworks: "https://www.fabworks.com/",
  fabworksMcp: "https://api.fabworks.com/mcp",
  ponoko: "https://www.ponoko.com/",
  sendCutSend: "https://sendcutsend.com/",
} as const;

export function fabworksLink(): VendorLink {
  return {
    vendor: "Fabworks",
    url: VENDORS.fabworks,
    note: "Sheet-metal quote and DFM. Their MCP (https://api.fabworks.com/mcp) needs OAuth, so this lane links a person there instead of calling it.",
  };
}

export function ponokoLink(): VendorLink {
  return {
    vendor: "Ponoko",
    url: VENDORS.ponoko,
    note: "Laser-cut plywood, MDF, and other sheet goods. Upload the DXF for a price. No order is placed here.",
  };
}

export function sendCutSendLink(): VendorLink {
  return {
    vendor: "SendCutSend",
    url: VENDORS.sendCutSend,
    note: "Flat-part laser cutting when the blank is larger than a desktop printer. Upload the DXF on their site. No public buyer API and no order is placed here.",
  };
}

export function craftcloudUploadLink(): VendorLink {
  return {
    vendor: "Craftcloud",
    url: VENDORS.craftcloudUpload,
    note: "Print network for plastics that do not fit a Bambu A1 or Prusa MK4. Upload the STL or 3MF to compare shops.",
  };
}
