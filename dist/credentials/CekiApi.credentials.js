"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// credentials/CekiApi.credentials.ts
var CekiApi_credentials_exports = {};
__export(CekiApi_credentials_exports, {
  CekiApi: () => CekiApi
});
module.exports = __toCommonJS(CekiApi_credentials_exports);
var CekiApi = class {
  constructor() {
    this.name = "cekiApi";
    this.displayName = "Ceki API";
    this.documentationUrl = "https://browser.ceki.me/docs#api-key";
    this.properties = [
      {
        displayName: "API Key",
        name: "token",
        type: "string",
        typeOptions: { password: true },
        default: "",
        description: "Agent token (ag_...). [Get your API key \u2192](https://browser.ceki.me/docs#api-key)",
        required: true
      }
    ];
    this.authenticate = {
      type: "generic",
      properties: {
        headers: {
          Authorization: "=Bearer {{$credentials?.token}}"
        }
      }
    };
    this.test = {
      request: {
        baseURL: "https://api.ceki.me",
        url: "/api/browsers/search",
        method: "GET"
      }
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CekiApi
});
//# sourceMappingURL=CekiApi.credentials.js.map
