import hre from "hardhat";
import { getCreate2Address, encodeFunctionData, keccak256, Hex, encodeAbiParameters } from "viem";
import { Worker } from "worker_threads";
import * as os from "os";
import {
  NEO_X_MAINNET_CHAIN_ID,
  NEO_X_T4_CHAIN_ID,
  SAFE_SINGLETON_FACTORY,
  getExpectedOwner,
  getMinimalUUPSContract,
  getMinimalUUPSSalt,
  isMainnet,
  validateChainId,
} from "./addresses";

/**
 * Select the target chain's MinimalUUPS and owner configuration.
 * TARGET_CHAIN_ID takes precedence; USE_MAINNET remains supported for existing workflows.
 */
const TARGET_CHAIN_ID = Number(
  process.env.TARGET_CHAIN_ID ?? (process.env.USE_MAINNET === "1" ? 1 : 11155111)
);
validateChainId(TARGET_CHAIN_ID);
const USE_MAINNET = isMainnet(TARGET_CHAIN_ID);
const MINIMAL_UUPS_CONTRACT = getMinimalUUPSContract(TARGET_CHAIN_ID);
const MINIMAL_UUPS_SALT = getMinimalUUPSSalt(TARGET_CHAIN_ID);
const EXPECTED_OWNER = getExpectedOwner(TARGET_CHAIN_ID);
const IDENTITY_VANITY_PREFIX = TARGET_CHAIN_ID === NEO_X_T4_CHAIN_ID
  ? "0x8004A8"
  : TARGET_CHAIN_ID === NEO_X_MAINNET_CHAIN_ID
    ? "0x8004A1"
    : "0x8004A";
const REPUTATION_VANITY_PREFIX = TARGET_CHAIN_ID === NEO_X_T4_CHAIN_ID
  ? "0x8004B6"
  : TARGET_CHAIN_ID === NEO_X_MAINNET_CHAIN_ID
    ? "0x8004BA"
    : "0x8004B";

/**
 * Gets the deployment bytecode for a proxy contract
 */
async function getProxyBytecode(
  implementationAddress: string,
  initCalldata: Hex
): Promise<Hex> {
  const proxyArtifact = await hre.artifacts.readArtifact("ERC1967Proxy");

  const constructorArgs = encodeAbiParameters(
    [
      { name: "implementation", type: "address" },
      { name: "data", type: "bytes" }
    ],
    [implementationAddress as `0x${string}`, initCalldata]
  );

  const fullBytecode = (proxyArtifact.bytecode + constructorArgs.slice(2)) as Hex;
  return fullBytecode;
}

/**
 * Search for vanity address in parallel using worker threads
 */
function findVanitySaltParallel(
  checksummedPrefix: string,
  bytecode: Hex,
  numWorkers: number = os.cpus().length
): Promise<{ salt: Hex; address: string; iterations: number }> {
  return new Promise((resolve, reject) => {
    console.log(`Searching for exact checksummed prefix: ${checksummedPrefix}`);
    console.log(`Using ${numWorkers} worker threads`);

    const workers: Worker[] = [];
    let found = false;
    const startTime = Date.now();

    // Create worker code as a string
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      const { getCreate2Address, keccak256 } = require('viem');

      const { startSalt, factoryAddress, bytecode, checksummedPrefix } = workerData;

      let salt = BigInt(startSalt);
      let iterations = 0;
      let found = false;

      while (!found) {
        iterations++;

        const saltHex = '0x' + salt.toString(16).padStart(64, '0');
        const address = getCreate2Address({
          from: factoryAddress,
          salt: saltHex,
          bytecodeHash: keccak256(bytecode),
        });

        if (address.startsWith(checksummedPrefix)) {
          parentPort.postMessage({
            type: 'found',
            salt: saltHex,
            address,
            iterations
          });
          found = true;
          break;
        }

        // Check every 10000 iterations if we should stop
        if (iterations % 10000 === 0) {
          parentPort.postMessage({
            type: 'progress',
            iterations
          });
        }

        salt += BigInt(${numWorkers});
      }
    `;

    // Create workers
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: {
          startSalt: i,
          factoryAddress: SAFE_SINGLETON_FACTORY,
          bytecode,
          checksummedPrefix
        }
      });

      worker.on('message', (msg) => {
        if (msg.type === 'found' && !found) {
          found = true;
          const elapsed = (Date.now() - startTime) / 1000;
          console.log(`✅ Found matching address after ${msg.iterations.toLocaleString()} iterations in ${elapsed.toFixed(2)}s`);
          console.log(`   Salt: ${msg.salt}`);
          console.log(`   Address: ${msg.address}`);

          // Terminate all workers
          workers.forEach(w => w.terminate());

          resolve({
            salt: msg.salt as Hex,
            address: msg.address,
            iterations: msg.iterations
          });
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0 && !found) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });

      workers.push(worker);
    }
  });
}

async function main() {
  console.log("Finding Vanity Addresses for ERC-8004 Proxies (PARALLEL)");
  console.log("=".repeat(70));
  console.log("");

  const numWorkers = os.cpus().length;
  console.log(`System has ${numWorkers} CPU cores`);
  console.log("");

  // Calculate MinimalUUPS address (single instance)
  console.log(`Step 0: Calculating ${MINIMAL_UUPS_CONTRACT} address...`);
  console.log(`   Target chain ID: ${TARGET_CHAIN_ID}`);
  console.log(`   Mode: ${USE_MAINNET ? "MAINNET" : "TESTNET"}`);
  console.log(`   Owner: ${EXPECTED_OWNER}`);
  const minimalUUPSArtifact = await hre.artifacts.readArtifact(MINIMAL_UUPS_CONTRACT);
  const minimalUUPSBytecode = minimalUUPSArtifact.bytecode as Hex;
  const getInitializerArgs = (identityRegistry: `0x${string}`) =>
    MINIMAL_UUPS_CONTRACT === "MinimalUUPSWithOwner"
      ? [identityRegistry, EXPECTED_OWNER]
      : [identityRegistry];

  const minimalUUPSAddress = getCreate2Address({
    from: SAFE_SINGLETON_FACTORY,
    salt: MINIMAL_UUPS_SALT,
    bytecodeHash: keccak256(minimalUUPSBytecode),
  });

  console.log(`✅ ${MINIMAL_UUPS_CONTRACT}: ${minimalUUPSAddress}`);
  console.log("");

  // Find salt for IdentityRegistry proxy
  // Initialize with zero address
  console.log(`Step 1: Finding salt for IdentityRegistry (${IDENTITY_VANITY_PREFIX})...`);
  console.log("        Initialize with: 0x0000000000000000000000000000000000000000");
  const identityInitData = encodeFunctionData({
    abi: minimalUUPSArtifact.abi,
    functionName: "initialize",
    args: getInitializerArgs("0x0000000000000000000000000000000000000000")
  });
  const identityProxyBytecode = await getProxyBytecode(minimalUUPSAddress, identityInitData);
  const identityResult = await findVanitySaltParallel(IDENTITY_VANITY_PREFIX, identityProxyBytecode, numWorkers);
  console.log("");

  // Calculate IdentityRegistry proxy address
  console.log("Step 2: Calculating IdentityRegistry proxy address...");
  const identityProxyAddress = getCreate2Address({
    from: SAFE_SINGLETON_FACTORY,
    salt: identityResult.salt,
    bytecodeHash: keccak256(identityProxyBytecode),
  });
  console.log(`✅ IdentityRegistry proxy will be at: ${identityProxyAddress}`);
  console.log("");

  // Find salt for ReputationRegistry proxy
  // Initialize with IdentityRegistry address
  console.log(`Step 3: Finding salt for ReputationRegistry (${REPUTATION_VANITY_PREFIX})...`);
  console.log(`        Initialize with: ${identityProxyAddress}`);
  const reputationInitData = encodeFunctionData({
    abi: minimalUUPSArtifact.abi,
    functionName: "initialize",
    args: getInitializerArgs(identityProxyAddress)
  });
  const reputationProxyBytecode = await getProxyBytecode(minimalUUPSAddress, reputationInitData);
  const reputationResult = await findVanitySaltParallel(REPUTATION_VANITY_PREFIX, reputationProxyBytecode, numWorkers);
  console.log("");

  // Find salt for ValidationRegistry proxy (0x8004C)
  // Initialize with IdentityRegistry address
  console.log("Step 4: Finding salt for ValidationRegistry (0x8004C)...");
  console.log(`        Initialize with: ${identityProxyAddress}`);
  const validationInitData = encodeFunctionData({
    abi: minimalUUPSArtifact.abi,
    functionName: "initialize",
    args: getInitializerArgs(identityProxyAddress)
  });
  const validationProxyBytecode = await getProxyBytecode(minimalUUPSAddress, validationInitData);
  const validationResult = await findVanitySaltParallel("0x8004C", validationProxyBytecode, numWorkers);
  console.log("");

  // Summary
  console.log("=".repeat(80));
  console.log("Vanity Proxy Salts Found!");
  console.log("=".repeat(80));
  console.log("");
  console.log(`${MINIMAL_UUPS_CONTRACT} Address:`, minimalUUPSAddress);
  console.log("");
  console.log("IdentityRegistry Proxy:");
  console.log("  Salt:    ", identityResult.salt);
  console.log("  Address: ", identityResult.address);
  console.log(`  Owner:    ${EXPECTED_OWNER}`);
  console.log("");
  console.log("ReputationRegistry Proxy:");
  console.log("  Salt:    ", reputationResult.salt);
  console.log("  Address: ", reputationResult.address);
  console.log(`  Owner:    ${EXPECTED_OWNER}`);
  console.log("");
  console.log("ValidationRegistry Proxy:");
  console.log("  Salt:    ", validationResult.salt);
  console.log("  Address: ", validationResult.address);
  console.log(`  Owner:    ${EXPECTED_OWNER}`);
  console.log("");
  console.log("=".repeat(80));
  console.log("Next steps:");
  console.log("1. Add chain-specific addresses and salts to scripts/addresses.ts");
  console.log("2. Run the deployment script; it will verify every CREATE2 address before sending");
  console.log("3. Run scripts/verify-vanity.ts after deployment");
  console.log("");

  return {
    salts: {
      identity: identityResult.salt,
      reputation: reputationResult.salt,
      validation: validationResult.salt
    },
    addresses: {
      identity: identityResult.address,
      reputation: reputationResult.address,
      validation: validationResult.address
    }
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
