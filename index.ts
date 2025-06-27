import fetch from 'node-fetch';
import {
    encodeFunctionData,
    decodeFunctionResult,
    type Address,
    formatUnits,
    type Hex
} from 'viem';

// =======================
// === ОСНОВНОЙ КОНФИГ ===
// =======================
const RPC_URL = 'http://188.234.213.4:4202';

// --- Адреса пользователей ---
const SCILLA_USER_ADDRESS = '0x77e27c39ce572283b848e2cdf32cce761e34fa49';
const EVM_USER_ADDRESS: Address = '0xb1fE20CD2b856BA1a4e08afb39dfF5C80f0cBbCa';

const SCILLA_USER_ADDRESS_LOWER = SCILLA_USER_ADDRESS.toLowerCase();

// --- Адреса контрактов ---
const SCILLA_GZIL_CONTRACT = 'a7C67D49C82c7dc1B73D231640B2e4d0661D37c1';
const ST_ZIL_CONTRACT = 'e6f14afc8739a4ead0a542c07d3ff978190e3b92';
const DEPOSIT_ADDRESS: Address = '0x00000000005a494c4445504f53495450524f5859';

// ========================
// === ИНТЕРФЕЙСЫ И ТИПЫ ===
// ========================

// RPC
interface RpcRequest {
    jsonrpc: string;
    method: string;
    params: any[];
    id: number;
}

interface RpcResponse {
    jsonrpc: string;
    result: any;
    id: number;
    error?: { code: number; message: string };
}

// Scilla
interface SSNode {
    name: string;
    url: string;
    address: string;
    lastrewardcycle: bigint;
    lastWithdrawCcleDleg: bigint;
}

interface ScillaStakedNode {
    node: SSNode;
    deleg_amt: bigint;
    rewards: bigint;
}

// EVM
enum StakingPoolType {
    LIQUID = 'LIQUID',
    NORMAL = 'NON_LIQUID',
}

interface EvmPool {
    id: string;
    address: Address;
    tokenAddress: Address;
    name: string;
    poolType: StakingPoolType;
    tokenDecimals: number;
    tokenSymbol: string;
}

// Структура для хранения статистики пула
interface EvmPoolStats {
    tvl?: bigint;
    pool_stake?: bigint;
    commission_num?: bigint;
    commission_den?: bigint;
}

// Финальный результат
interface FinalOutput {
    name: string;
    url: string;
    address: string;
    tokenAddress?: string;
    deleg_amt: bigint;
    rewards: bigint;
    tvl?: string;      // Total Value Locked (форматированный)
    vote_power?: number; // Vote Power в процентах
    apr?: number;
    commission?: number; // Комиссия в процентах
    tag: 'scilla' | 'avely' | 'evm';
}

// Тип для карты EVM запросов
type EvmRequestMap = Map<string, { pool: EvmPool, reqType: 'deleg_amt' | 'rewards' | 'pool_stake' | 'commission' | 'tvl' }>;
type ResultsByIdMap = Map<number, RpcResponse>;


// =====================
// === EVM КОНФИГ (ABIs) ===
// =====================

const erc20Abi = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ type: 'address', name: 'account' }],
        outputs: [{ type: 'uint256', name: 'balance' }],
    },
    {
        name: 'totalSupply',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    }
] as const;

const nonLiquidDelegatorAbi = [
    {
        name: 'getDelegatedAmount',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'rewards',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    },
    {
        name: 'getDelegatedTotal', // Для TVL неликвидных пулов
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    }
] as const;

const depositAbi = [
    {
        inputs: [],
        name: "getFutureTotalStake",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

const evmDelegatorAbi = [
    {
        name: 'getStake',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        name: 'getCommission',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    },
] as const;


// Список EVM пулов
const protoMainnetPools: EvmPool[] = [
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


// ===============================
// === ФУНКЦИИ ДЛЯ РАБОТЫ С RPC ===
// ===============================

/**
 * Выполняет пакетный JSON-RPC запрос.
 * @param requests Массив объектов запросов.
 * @returns Промис, который разрешается в массив ответов.
 */
async function callJsonRPC(requests: RpcRequest[]): Promise<RpcResponse[]> {
    if (requests.length === 0) {
        return [];
    }
    const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requests),
    });
    const data = await response.json();
    return Array.isArray(data) ? data : [data as RpcResponse];
}


// ===================================
// === ЛОГИКА ДЛЯ SCILLA И AVELY ===
// ===================================
const KEY_LAST_REWARD_CYCLE = 'lastrewardcycle';
const KEY_LAST_WITHDRAW_CYCLE = 'last_withdraw_cycle_deleg';

function get_reward_need_cycle_list(last_withdraw_cycle: bigint, last_reward_cycle: bigint): number[] {
    const cycles: number[] = [];
    if (last_reward_cycle <= last_withdraw_cycle) return [];
    for (let i = Number(last_withdraw_cycle) + 1; i <= Number(last_reward_cycle); i++) {
        cycles.push(i);
    }
    return cycles;
}

function combine_buff_direct(reward_list: number[], direct_deposit_map: Record<string, string>, buffer_deposit_map: Record<string, string>, deleg_stake_per_cycle_map: Record<string, string>): Map<number, bigint> {
    const result_map = new Map<number, bigint>();
    for (const cycle of reward_list) {
        const c1 = cycle - 1;
        const c2 = cycle - 2;
        const hist_amt = BigInt(deleg_stake_per_cycle_map[c1.toString()] ?? '0');
        const dir_amt = BigInt(direct_deposit_map[c1.toString()] ?? '0');
        const buf_amt = BigInt(buffer_deposit_map[c2.toString()] ?? '0');
        const total_amt_tmp = dir_amt + buf_amt + hist_amt;
        const previous_cycle_amt = result_map.get(c1) ?? 0n;
        const total_amt = total_amt_tmp + previous_cycle_amt;
        result_map.set(cycle, total_amt);
    }
    return result_map;
}
function calculate_rewards(delegate_per_cycle: Map<number, bigint>, need_list: number[], stake_ssn_per_cycle_map: Record<string, { arguments: [string, string] }>): bigint {
    let result_rewards = 0n;
    if (!stake_ssn_per_cycle_map) return result_rewards;
    for (const cycle of need_list) {
        const cycle_info = stake_ssn_per_cycle_map[cycle.toString()];
        if (cycle_info) {
            const total_stake = BigInt(cycle_info.arguments[0]);
            const total_rewards = BigInt(cycle_info.arguments[1]);
            const deleg_amt = delegate_per_cycle.get(cycle);
            if (deleg_amt && total_stake > 0n) {
                result_rewards += (deleg_amt * total_rewards) / total_stake;
            }
        }
    }
    return result_rewards;
}

// ==================================================
// === ФУНКЦИИ-КОНСТРУКТОРЫ ПАКЕТНЫХ ЗАПРОСОВ (BUILDERS) ===
// ==================================================

/**
 * Создает начальный пакет запросов для Scilla, Avely и общего стейка сети.
 * @param startId Начальный идентификатор для запросов.
 * @returns Объект с пакетом запросов, картой ID и следующим доступным ID.
 */
function buildInitialCoreRequests(startId: number) {
    const ids = {
        ssnList: startId++,
        rewardCycle: startId++,
        withdrawCycle: startId++,
        stZilBalance: startId++,
        totalNetworkStake: startId++,
    };

    const requests: RpcRequest[] = [
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'ssnlist', []], id: ids.ssnList },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, KEY_LAST_REWARD_CYCLE, []], id: ids.rewardCycle },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, KEY_LAST_WITHDRAW_CYCLE, [SCILLA_USER_ADDRESS]], id: ids.withdrawCycle },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [ST_ZIL_CONTRACT, 'balances', [SCILLA_USER_ADDRESS_LOWER]], id: ids.stZilBalance },
        { jsonrpc: '2.0', method: 'eth_call', params: [{ to: DEPOSIT_ADDRESS, data: encodeFunctionData({ abi: depositAbi, functionName: 'getFutureTotalStake' }) }, 'latest'], id: ids.totalNetworkStake }
    ];

    return { requests, ids, nextId: startId };
}

/**
 * Создает пакет запросов для всех EVM пулов (данные пользователя и статистика пула).
 * @param pools Массив EVM пулов.
 * @param startId Начальный идентификатор для запросов.
 * @returns Объект с пакетом запросов, картой запросов и следующим доступным ID.
 */
function buildEvmPoolsRequests(pools: EvmPool[], startId: number) {
    let currentId = startId;
    const requests: RpcRequest[] = [];
    const evmRequestMap: EvmRequestMap = new Map();

    pools.forEach(pool => {
        // --- Запросы для пользователя ---
        const delegAmtId = currentId++;
        requests.push(pool.poolType === StakingPoolType.LIQUID
            ? { jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.tokenAddress, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [EVM_USER_ADDRESS] }) }, 'latest'], id: delegAmtId }
            : { jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: nonLiquidDelegatorAbi, functionName: 'getDelegatedAmount' }), from: EVM_USER_ADDRESS }, 'latest'], id: delegAmtId }
        );
        evmRequestMap.set(String(delegAmtId), { pool, reqType: 'deleg_amt' });

        if (pool.poolType === StakingPoolType.NORMAL) {
            const rewardsId = currentId++;
            requests.push({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: nonLiquidDelegatorAbi, functionName: 'rewards' }), from: EVM_USER_ADDRESS }, 'latest'], id: rewardsId });
            evmRequestMap.set(String(rewardsId), { pool, reqType: 'rewards' });
        }

        // --- Запросы для статистики пула ---
        const tvlId = currentId++;
        requests.push(pool.poolType === StakingPoolType.LIQUID
            ? { jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.tokenAddress, data: encodeFunctionData({ abi: erc20Abi, functionName: 'totalSupply' }) }, 'latest'], id: tvlId }
            : { jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: nonLiquidDelegatorAbi, functionName: 'getDelegatedTotal' }) }, 'latest'], id: tvlId }
        );
        evmRequestMap.set(String(tvlId), { pool, reqType: 'tvl' });

        const poolStakeId = currentId++;
        requests.push({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: evmDelegatorAbi, functionName: 'getStake' }) }, 'latest'], id: poolStakeId });
        evmRequestMap.set(String(poolStakeId), { pool, reqType: 'pool_stake' });

        const commissionId = currentId++;
        requests.push({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: evmDelegatorAbi, functionName: 'getCommission' }) }, 'latest'], id: commissionId });
        evmRequestMap.set(String(commissionId), { pool, reqType: 'commission' });
    });

    return { requests, evmRequestMap, nextId: currentId };
}


// ===============================================
// === ФУНКЦИИ-ОБРАБОТЧИКИ РЕЗУЛЬТАТОВ (PROCESSORS) ===
// ===============================================

/**
 * Обрабатывает результаты запросов к EVM пулам, декодирует данные.
 * @param resultsById Карта ответов RPC по их ID.
 * @param evmRequestMap Карта, связывающая ID запросов с информацией о пулах.
 * @returns Промежуточные данные о стейках пользователя и статистике пулов.
 */
function processEvmPoolsResults(resultsById: ResultsByIdMap, evmRequestMap: EvmRequestMap) {
    const tempEvmUserData = new Map<string, { deleg_amt: bigint, rewards: bigint }>();
    const tempEvmPoolStats = new Map<string, EvmPoolStats>();

    for (const [id, res] of resultsById.entries()) {
        const reqInfo = evmRequestMap.get(String(id));
        if (!reqInfo) continue;

        const { pool, reqType } = reqInfo;
        if (res.error || !res.result || res.result === "0x") continue;

        const userData = tempEvmUserData.get(pool.id) ?? { deleg_amt: 0n, rewards: 0n };
        const poolStats = tempEvmPoolStats.get(pool.id) ?? {};

        try {
            switch (reqType) {
                case 'deleg_amt':
                    const decodedDelegAmt = decodeFunctionResult({ abi: pool.poolType === 'LIQUID' ? erc20Abi : nonLiquidDelegatorAbi, functionName: pool.poolType === 'LIQUID' ? 'balanceOf' : 'getDelegatedAmount', data: res.result as Hex });
                    userData.deleg_amt = BigInt(decodedDelegAmt as any ?? 0);
                    break;
                case 'rewards':
                    const decodedRewards = decodeFunctionResult({ abi: nonLiquidDelegatorAbi, functionName: 'rewards', data: res.result as Hex });
                    userData.rewards = BigInt(decodedRewards as any ?? 0);
                    break;
                case 'tvl':
                     const decodedTvl = decodeFunctionResult({ abi: pool.poolType === 'LIQUID' ? erc20Abi : nonLiquidDelegatorAbi, functionName: pool.poolType === 'LIQUID' ? 'totalSupply' : 'getDelegatedTotal', data: res.result as Hex });
                    poolStats.tvl = BigInt(decodedTvl as any ?? 0);
                    break;
                case 'pool_stake':
                    const decodedStake = decodeFunctionResult({ abi: evmDelegatorAbi, functionName: 'getStake', data: res.result as Hex });
                    poolStats.pool_stake = BigInt(decodedStake as any ?? 0);
                    break;
                case 'commission':
                    const decodedCommission = decodeFunctionResult({ abi: evmDelegatorAbi, functionName: 'getCommission', data: res.result as Hex });
                    if (Array.isArray(decodedCommission)) {
                        poolStats.commission_num = BigInt(decodedCommission[0] ?? 0);
                        poolStats.commission_den = BigInt(decodedCommission[1] ?? 1);
                    }
                    break;
            }
        } catch (e) {
            console.error(`Error decoding result for pool ${pool.name} (reqType: ${reqType}):`, e);
            continue;
        }

        tempEvmUserData.set(pool.id, userData);
        tempEvmPoolStats.set(pool.id, poolStats);
    }
    return { tempEvmUserData, tempEvmPoolStats };
}


/**
 * Собирает финальный массив стейков в EVM пулах, вычисляет APR и Vote Power.
 * @param pools Список всех EVM пулов.
 * @param userData Данные о стейках пользователя.
 * @param poolStats Статистика пулов (TVL, комиссия и т.д.).
 * @param totalNetworkStake Общий стейк в сети.
 * @returns Массив объектов FinalOutput для EVM пулов.
 */
function assembleEvmFinalOutput(
    pools: EvmPool[],
    userData: Map<string, { deleg_amt: bigint, rewards: bigint }>,
    poolStats: Map<string, EvmPoolStats>,
    totalNetworkStake: bigint
): FinalOutput[] {
    const finalOutput: FinalOutput[] = [];

    pools.forEach(pool => {
        const userEntry = userData.get(pool.id);
        const statsEntry = poolStats.get(pool.id);

        if (!(userEntry?.deleg_amt > 0n) && !(statsEntry?.tvl > 0n)) {
            return; // Пропускаем пулы без стейка пользователя и без TVL
        }

        const outputEntry: FinalOutput = {
            name: pool.name,
            url: "",
            address: pool.address,
            tokenAddress: pool.tokenAddress,
            deleg_amt: userEntry?.deleg_amt ?? 0n,
            rewards: userEntry?.rewards ?? 0n,
            tag: 'evm'
        };

        if (statsEntry) {
            if (statsEntry.tvl) {
                outputEntry.tvl = formatUnits(statsEntry.tvl, pool.tokenDecimals);
            }

            const { pool_stake, commission_num, commission_den } = statsEntry;
            if (pool_stake && totalNetworkStake > 0n) {
                const bigintDivisionPrecision = 1000000n;

                // Расчет Vote Power
                const vpRatio = Number((pool_stake * bigintDivisionPrecision) / totalNetworkStake) / Number(bigintDivisionPrecision);
                outputEntry.vote_power = parseFloat((vpRatio * 100).toFixed(4));

                // Расчет APR и Комиссии
                if (commission_den && commission_den > 0n) {
                    const rewardsPerYearInZil = 51000 * 24 * 365;
                    const commissionRatio = Number(((commission_num ?? 0n) * bigintDivisionPrecision) / commission_den) / Number(bigintDivisionPrecision);
                    
                    // Сохраняем комиссию в процентах
                    outputEntry.commission = parseFloat((commissionRatio * 100).toFixed(4));
                    
                    const delegatorYearReward = vpRatio * rewardsPerYearInZil;
                    const delegatorRewardForShare = delegatorYearReward * (1 - commissionRatio);

                    const poolStakeInZil = parseFloat(formatUnits(pool_stake, 18));
                    if (poolStakeInZil > 0) {
                        outputEntry.apr = parseFloat(((delegatorRewardForShare / poolStakeInZil) * 100).toFixed(4));
                    }
                }
            }
        }
        finalOutput.push(outputEntry);
    });

    return finalOutput;
}


/**
 * Обрабатывает стейк пользователя в Avely (stZIL).
 * @param stZilResult Результат RPC запроса на баланс stZIL.
 * @returns Объект FinalOutput для Avely или null, если баланс нулевой.
 */
function processAvelyStake(stZilResult: RpcResponse | undefined): FinalOutput | null {
    const stZilBalanceAmount = stZilResult?.result?.balances?.[SCILLA_USER_ADDRESS_LOWER];
    const stZilBalance = stZilBalanceAmount ? BigInt(stZilBalanceAmount) : 0n;

    if (stZilBalance > 0n) {
        return {
            name: "stZIL (Avely Finance)",
            url: "https://avely.fi/",
            address: ST_ZIL_CONTRACT,
            deleg_amt: stZilBalance,
            rewards: 0n,
            tag: 'avely',
        };
    }
    return null;
}

/**
 * Обрабатывает все стейки пользователя в Scilla SSN, включая расчет наград.
 * @param ssnResult Результат RPC с полным списком нод.
 * @param rewardCycleResult Результат RPC с последним наградным циклом.
 * @param withdrawCycleResult Результат RPC с последним циклом вывода для пользователя.
 * @returns Промис, который разрешается в массив FinalOutput для Scilla нод.
 */
async function processScillaStakes(
    ssnResult: RpcResponse | undefined,
    rewardCycleResult: RpcResponse | undefined,
    withdrawCycleResult: RpcResponse | undefined
): Promise<FinalOutput[]> {
    if (!ssnResult?.result?.ssnlist || !rewardCycleResult?.result || !withdrawCycleResult?.result) {
        return [];
    }

    const ssnlist = ssnResult.result['ssnlist'];
    const lastrewardcycle = BigInt(rewardCycleResult.result[KEY_LAST_REWARD_CYCLE]);
    const lastWithdrawNodes = withdrawCycleResult.result[KEY_LAST_WITHDRAW_CYCLE]?.[SCILLA_USER_ADDRESS] ?? {};

    const allSsnNodes: SSNode[] = Object.keys(ssnlist).map((key) => ({
        name: ssnlist[key].arguments[3],
        url: ssnlist[key].arguments[5],
        address: key,
        lastrewardcycle,
        lastWithdrawCcleDleg: lastWithdrawNodes[key] ? BigInt(lastWithdrawNodes[key]) : 0n,
    }));
    
    // --- Шаг 1: Найти все ноды, в которых у пользователя есть стейк ---
    const delegAmtRequests = allSsnNodes.map((node, index) => ({
        jsonrpc: '2.0' as const, method: 'GetSmartContractSubState',
        params: [SCILLA_GZIL_CONTRACT, 'ssn_deleg_amt', [node.address, SCILLA_USER_ADDRESS]],
        id: index
    }));
    const delegAmtResults = await callJsonRPC(delegAmtRequests);

    let stakedScillaNodes: ScillaStakedNode[] = [];
    for (const res of delegAmtResults) {
        const node = allSsnNodes[res.id];
        const delegations = res.result?.['ssn_deleg_amt']?.[node.address]?.[SCILLA_USER_ADDRESS];
        if (delegations) {
            const amountQA = BigInt(delegations);
            if (amountQA > 0n) {
                stakedScillaNodes.push({ node, deleg_amt: amountQA, rewards: 0n });
            }
        }
    }

    if (stakedScillaNodes.length === 0) return [];
    
    // --- Шаг 2: Для застейканных нод, запросить данные для расчета наград ---
    const rewardDataRequests = stakedScillaNodes.flatMap((stakedNode, index) => [
        { jsonrpc: '2.0' as const, method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'direct_deposit_deleg', [SCILLA_USER_ADDRESS_LOWER, stakedNode.node.address]], id: index * 4 + 1 },
        { jsonrpc: '2.0' as const, method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'buff_deposit_deleg', [SCILLA_USER_ADDRESS_LOWER, stakedNode.node.address]], id: index * 4 + 2 },
        { jsonrpc: '2.0' as const, method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'deleg_stake_per_cycle', [SCILLA_USER_ADDRESS_LOWER, stakedNode.node.address]], id: index * 4 + 3 },
        { jsonrpc: '2.0' as const, method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'stake_ssn_per_cycle', [stakedNode.node.address]], id: index * 4 + 4 },
    ]);
    const rewardDataResults = await callJsonRPC(rewardDataRequests);
    const rewardResultsById: ResultsByIdMap = new Map(rewardDataResults.map(r => [r.id, r]));

    // --- Шаг 3: Рассчитать награды ---
    stakedScillaNodes.forEach((stakedNode, i) => {
        const directRes = rewardResultsById.get(i * 4 + 1);
        const buffRes = rewardResultsById.get(i * 4 + 2);
        const delegCycleRes = rewardResultsById.get(i * 4 + 3);
        const stakeSsnCycleRes = rewardResultsById.get(i * 4 + 4);

        const direct_map = directRes?.result?.direct_deposit_deleg?.[SCILLA_USER_ADDRESS_LOWER]?.[stakedNode.node.address] || {};
        const buffer_map = buffRes?.result?.buff_deposit_deleg?.[SCILLA_USER_ADDRESS_LOWER]?.[stakedNode.node.address] || {};
        const deleg_cycle_map = delegCycleRes?.result?.deleg_stake_per_cycle?.[SCILLA_USER_ADDRESS_LOWER]?.[stakedNode.node.address] || {};
        const stake_ssn_map = stakeSsnCycleRes?.result?.stake_ssn_per_cycle?.[stakedNode.node.address] || {};

        const reward_need_list = get_reward_need_cycle_list(stakedNode.node.lastWithdrawCcleDleg, stakedNode.node.lastrewardcycle);
        if (reward_need_list.length > 0) {
            const delegate_per_cycle = combine_buff_direct(reward_need_list, direct_map, buffer_map, deleg_cycle_map);
            stakedNode.rewards = calculate_rewards(delegate_per_cycle, reward_need_list, stake_ssn_map);
        }
    });
    
    return stakedScillaNodes.map(sn => ({
        name: sn.node.name,
        url: sn.node.url,
        address: sn.node.address,
        deleg_amt: sn.deleg_amt,
        rewards: sn.rewards,
        tag: 'scilla',
    }));
}


// =======================
// === ОСНОВНОЕ ВЫПОЛНЕНИЕ ===
// =======================

/**
 * Главная функция-оркестратор.
 */
async function main() {
    // --- 1. Формирование основного пакета запросов ---
    const coreReqs = buildInitialCoreRequests(1);
    const evmReqs = buildEvmPoolsRequests(protoMainnetPools, coreReqs.nextId);
    
    const allRequests = [...coreReqs.requests, ...evmReqs.requests];

    // --- 2. Выполнение всех запросов одним пакетом ---
    console.log(`Отправка ${allRequests.length} запросов...`);
    const allResults = await callJsonRPC(allRequests);
    const resultsById: ResultsByIdMap = new Map(allResults.map(res => [res.id, res]));
    console.log("Все запросы выполнены.");

    // --- 3. Обработка результатов ---
    const finalOutput: FinalOutput[] = [];

    // 3.1 Обработка EVM
    const totalNetworkStakeResponse = resultsById.get(coreReqs.ids.totalNetworkStake);
    const totalNetworkStake = totalNetworkStakeResponse?.result ? BigInt(totalNetworkStakeResponse.result) : 0n;
    
    const { tempEvmUserData, tempEvmPoolStats } = processEvmPoolsResults(resultsById, evmReqs.evmRequestMap);
    const evmStakes = assembleEvmFinalOutput(protoMainnetPools, tempEvmUserData, tempEvmPoolStats, totalNetworkStake);
    finalOutput.push(...evmStakes);

    // 3.2 Обработка Avely
    const avelyStake = processAvelyStake(resultsById.get(coreReqs.ids.stZilBalance));
    if (avelyStake) {
        finalOutput.push(avelyStake);
    }
    
    // 3.3 Обработка Scilla (с дополнительными запросами внутри)
    const scillaStakes = await processScillaStakes(
        resultsById.get(coreReqs.ids.ssnList),
        resultsById.get(coreReqs.ids.rewardCycle),
        resultsById.get(coreReqs.ids.withdrawCycle)
    );
    finalOutput.push(...scillaStakes);
    
    // --- 4. Сортировка и вывод результата ---
    finalOutput.sort((a, b) => {
        if (a.deleg_amt > b.deleg_amt) return -1;
        if (a.deleg_amt < b.deleg_amt) return 1;
        return a.name.localeCompare(b.name);
    });

    console.log(JSON.stringify(finalOutput, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch(console.error);

