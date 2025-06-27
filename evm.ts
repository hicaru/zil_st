// fetchUserData.ts
import {
  createPublicClient,
  http,
  defineChain,
  formatUnits,
  erc20Abi,
  type Address,
} from "viem";
import { DateTime } from "luxon";
import { readContract } from "viem/actions";

// --- КОНФИГУРАЦИЯ ---
// Замените этот адрес на адрес пользователя, данные которого вы хотите получить
const USER_ADDRESS: Address = "0xb1fE20CD2b856BA1a4e08afb39dfF5C80f0cBbCa"; // <--- ИЗМЕНИТЬ ЗДЕСЬ

const PROTOMAINNET_CHAIN_ID = 32770;
const PROTOMAINNET_RPC_URL = "http://188.234.213.4:4202";

// --- ABIs из `stakingAbis.ts` ---
const baseDelegatorAbi = [
  {
    inputs: [],
    name: "getPendingClaims",
    outputs: [{ internalType: "uint256[2][]", name: "claims", type: "uint256[2][]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getClaimable",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const nonLiquidDelegatorAbi = [
  {
    inputs: [],
    name: "getDelegatedAmount",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rewards",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// --- Определение сети и клиента Viem ---
const zq2ProtoMainnet = defineChain({
  id: PROTOMAINNET_CHAIN_ID,
  name: "Zq2 ProtoMainnet",
  nativeCurrency: { name: "ZIL", symbol: "ZIL", decimals: 18 },
  rpcUrls: { default: { http: [PROTOMAINNET_RPC_URL] } },
});

const client = createPublicClient({
  chain: zq2ProtoMainnet,
  transport: http(),
});

enum StakingPoolType {
  LIQUID = "LIQUID",
  NORMAL = "NON_LIQUID",
}

// --- Конфигурация пулов для ProtoMainnet (из `stakingPoolsConfig.ts`) ---
const protoMainnetPools = [
    { id: "MHhBMDU3", address: "0xA0572935d53e14C73eBb3de58d319A9Fe51E1FC8", tokenAddress: "0x0000000000000000000000000000000000000000", name: "Moonlet", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
    { id: "MHgyQWJl", address: "0x2Abed3a598CBDd8BB9089c09A9202FD80C55Df8c", tokenAddress: "0xD8B61fed51b9037A31C2Bf0a5dA4B717AF0C0F78", name: "AtomicWallet", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "SHARK" },
    { id: "MHhCOWQ2", address: "0xB9d689c64b969ad9eDd1EDDb50be42E217567fd3", tokenAddress: "0x0000000000000000000000000000000000000000", name: "CEX.IO", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
    { id: "MHhlMEMw", address: "0xe0C095DBE85a8ca75de4749B5AEe0D18100a3C39", tokenAddress: "0x7B213b5AEB896bC290F0cD8B8720eaF427098186", name: "PlunderSwap", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "pZIL" },
    { id: "MHhDMDI0", address: "0xC0247d13323F1D06b6f24350Eea03c5e0Fbf65ed", tokenAddress: "0x2c51C97b22E73AfD33911397A20Aa5176e7Ab951", name: "Luganodes", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "LNZIL" },
    { id: "MHg4QTBk", address: "0x8A0dEd57ABd3bc50A600c94aCbEcEf62db5f4D32", tokenAddress: "0x0000000000000000000000000000000000000000", name: "DTEAM", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
    { id: "MHgzYjFD", address: "0x3b1Cd55f995a9A8A634fc1A3cEB101e2baA636fc", tokenAddress: "0x0000000000000000000000000000000000000000", name: "Shardpool", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
    { id: "MHg2NmEy", address: "0x66a2bb4AD6999966616B2ad209833260F8eA07C8", tokenAddress: "0xA1Adc08C12c684AdB28B963f251d6cB1C6a9c0c1", name: "Encapsulate", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "encapZIL" },
    { id: "MHhlNTlE", address: "0xe59D98b887e6D40F52f7Cc8d5fb4CF0F9Ed7C98B", tokenAddress: "0xf564DF9BeB417FB50b38A58334CA7607B36D3BFb", name: "Amazing Pool - Avely and ZilPay", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "stZIL" },
    { id: "MHhkMDkw", address: "0xd090424684a9108229b830437b490363eB250A58", tokenAddress: "0xE10575244f8E8735d71ed00287e9d1403f03C960", name: "PathrockNetwork", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "zLST" },
    { id: "MHgzM2NE", address: "0x33cDb55D7fD68d0Da1a3448F11bCdA5fDE3426B3", tokenAddress: "0x0000000000000000000000000000000000000000", name: "BlackNodes", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
    { id: "MHgzNTEx", address: "0x35118Af4Fc43Ce58CEcBC6Eeb21D0C1Eb7E28Bd3", tokenAddress: "0x245E6AB0d092672B18F27025385f98E2EC3a3275", name: "Lithium Digital", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "litZil" },
    { id: "MHg2MjI2", address: "0x62269F615E1a3E36f96dcB7fDDF8B823737DD618", tokenAddress: "0x770a35A5A95c2107860E9F74c1845e20289cbfe6", name: "TorchWallet.io", poolType: StakingPoolType.LIQUID, tokenDecimals: 18, tokenSymbol: "tZIL" },
    { id: "MHhhNDUx", address: "0xa45114E92E26B978F0B37cF19E66634f997250f9", tokenAddress: "0x0000000000000000000000000000000000000000", name: "Stakefish", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
    { id: "MHgwMjM3", address: "0x02376bA9e0f98439eA9F76A582FBb5d20E298177", tokenAddress: "0x0000000000000000000000000000000000000000", name: "AlphaZIL (former Ezil)", poolType: StakingPoolType.NORMAL, tokenDecimals: 18, tokenSymbol: "ZIL" },
];

// --- Основная логика ---
async function main() {
  if (USER_ADDRESS === '0xYourWalletAddressHere') {
    console.error("Пожалуйста, укажите адрес кошелька в переменной USER_ADDRESS.");
    return;
  }
  console.log(`Получение данных для пользователя: ${USER_ADDRESS}\n`);

  // --- 1. Получение данных о стейках ---
  console.log("--- 1. Данные о стейках (Staked Balances) ---");
  const stakingDataPromises = protoMainnetPools.map(async (pool) => {
    let stakingTokenAmount = 0n;
    if (pool.poolType === StakingPoolType.LIQUID) {
      stakingTokenAmount = await readContract(client, {
        address: pool.tokenAddress as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [USER_ADDRESS],
      });
    } else { // NORMAL
      stakingTokenAmount = await readContract(client, {
        address: pool.address as Address,
        abi: nonLiquidDelegatorAbi,
        functionName: "getDelegatedAmount",
        account: USER_ADDRESS, // 'account' используется для переопределения from
      });
    }
    return { ...pool, stakingTokenAmount };
  });

  const stakingData = await Promise.all(stakingDataPromises);
  stakingData
    .filter((data) => data.stakingTokenAmount > 0n)
    .forEach((data) => {
      console.log(
        `  - ${data.name}: ${formatUnits(data.stakingTokenAmount, data.tokenDecimals)} ${data.tokenSymbol}`
      );
    });
  
  // --- 2. Получение данных о выводе средств ---
  console.log("\n--- 2. Данные о выводе (Unstaking Info) ---");
  const currentBlockNumber = await client.getBlockNumber();
  const unstakingDataPromises = protoMainnetPools.map(async (pool) => {
    const [blockNumberAndAmount, claimableNow] = await Promise.all([
      readContract(client, {
        address: pool.address as Address,
        abi: baseDelegatorAbi,
        functionName: "getPendingClaims",
        account: USER_ADDRESS,
      }),
      readContract(client, {
        address: pool.address as Address,
        abi: baseDelegatorAbi,
        functionName: "getClaimable",
        account: USER_ADDRESS,
      }),
    ]);
    return { pool, blockNumberAndAmount, claimableNow };
  });

  const unstakingDataRaw = await Promise.all(unstakingDataPromises);

  const allUnstakes = unstakingDataRaw.flatMap(({ pool, blockNumberAndAmount, claimableNow }) => {
    const claims = [];
    if (claimableNow > 0n) {
      claims.push({
        poolName: pool.name,
        zilAmount: claimableNow,
        status: "Доступно к выводу (Available to claim)",
      });
    }
    blockNumberAndAmount.forEach(([block, amount]) => {
      const blocksRemaining = Number(block - currentBlockNumber);
      // Предполагаем, что 1 блок = 2 секунды (уточнить для ZQ2)
      const secondsRemaining = blocksRemaining * 2; 
      const availableAt = DateTime.now().plus({ seconds: secondsRemaining });
      claims.push({
        poolName: pool.name,
        zilAmount: amount,
        status: `Ожидание (Pending). Будет доступно ~ ${availableAt.toRelative()}`,
      });
    });
    return claims;
  });

  if (allUnstakes.length > 0) {
    allUnstakes.forEach((unstake) => {
      console.log(
        `  - ${unstake.poolName}: ${formatUnits(unstake.zilAmount, 18)} ZIL. Статус: ${unstake.status}`
      );
    });
  } else {
    console.log("  Нет активных процессов вывода.");
  }


  // --- 3. Получение данных о наградах ---
  console.log("\n--- 3. Данные о наградах (Claimable Rewards) ---");
  const rewardPromises = protoMainnetPools
    .filter((pool) => pool.poolType === StakingPoolType.NORMAL)
    .map(async (pool) => {
      const zilRewardAmount = await readContract(client, {
        address: pool.address as Address,
        abi: nonLiquidDelegatorAbi,
        functionName: "rewards",
        account: USER_ADDRESS,
      });
      return { poolName: pool.name, zilRewardAmount };
    });
    
  const rewardsData = await Promise.all(rewardPromises);
  const claimableRewards = rewardsData.filter((r) => r.zilRewardAmount > 0n);

  if (claimableRewards.length > 0) {
    claimableRewards.forEach((reward) => {
      console.log(
        `  - ${reward.poolName}: ${formatUnits(reward.zilRewardAmount, 18)} ZIL`
      );
    });
  } else {
    console.log("  Нет наград, доступных для клейма.");
  }

}

main().catch(console.error);
