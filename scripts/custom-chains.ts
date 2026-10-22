import { defineChain } from "viem";

/**
 * Custom chain definitions for chains not yet in viem's built-in list.
 * Key must match the network name in hardhat.config.ts.
 */
export const customChains: Record<string, ReturnType<typeof defineChain>> = {
  neoxTestnet: defineChain({
    id: 12227332,
    name: "Neo X T4",
    nativeCurrency: { name: "GAS", symbol: "GAS", decimals: 18 },
    rpcUrls: {
      default: {
        http: [process.env.NEOX_TESTNET_RPC_URL || "https://neoxt4seed1.ngd.network"],
      },
    },
    blockExplorers: {
      default: {
        name: "Neo X T4 Explorer",
        url: "https://neoxt4scan.ngd.network",
      },
    },
    testnet: true,
  }),
  xlayerTestnet: defineChain({
    id: 1952,
    name: "XLayer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: ["https://testrpc.xlayer.tech"] } },
  }),
  goatTestnet: defineChain({
    id: 48816,
    name: "GOAT Testnet3",
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet3.goat.network"] } },
  }),
  skaleBaseSepolia: defineChain({
    id: 324705682,
    name: "SKALE Base Sepolia",
    nativeCurrency: { name: "Credits", symbol: "CREDIT", decimals: 18 },
    rpcUrls: { default: { http: ["https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha"] } },
  }),
  skaleBase: defineChain({
    id: 1187947933,
    name: "SKALE Base",
    nativeCurrency: { name: "Credits", symbol: "CREDIT", decimals: 18 },
    rpcUrls: { default: { http: ["https://skale-base.skalenodes.com/v1/base"] } },
  }),
  arcTestnet: defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  }),
};
