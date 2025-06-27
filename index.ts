import fetch from 'node-fetch';
import {
    type Abi,
    encodeFunctionData,
    decodeFunctionResult,
    type Address,
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

// Финальный результат
interface FinalOutput {
    name: string;
    url: string;
    address: string;
    tokenAddress?: string; // Опционально, для EVM
    deleg_amt: bigint;
    rewards: bigint;
    tag: 'scilla' | 'avely' | 'evm';
}


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

// Функции расчета наград (без изменений)
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

// =======================
// === ОСНОВНОЕ ВЫПОЛНЕНИЕ ===
// =======================

(async function main() {
    let batchIdCounter = 1;
    const batchRequests: RpcRequest[] = [];
    const evmRequestMap = new Map<string, { pool: EvmPool, reqType: 'deleg_amt' | 'rewards' }>();


    // --- 1.1. Добавляем Scilla и Avely запросы в пакет ---
    const SCILLA_ID_SSN_LIST = batchIdCounter++;
    const SCILLA_ID_REWARD_CYCLE = batchIdCounter++;
    const SCILLA_ID_WITHDRAW_CYCLE = batchIdCounter++;
    const AVELY_ID_STZIL_BALANCE = batchIdCounter++;

    batchRequests.push(
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'ssnlist', []], id: SCILLA_ID_SSN_LIST },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, KEY_LAST_REWARD_CYCLE, []], id: SCILLA_ID_REWARD_CYCLE },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, KEY_LAST_WITHDRAW_CYCLE, [SCILLA_USER_ADDRESS]], id: SCILLA_ID_WITHDRAW_CYCLE },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [ST_ZIL_CONTRACT, 'balances', [SCILLA_USER_ADDRESS_LOWER]], id: AVELY_ID_STZIL_BALANCE }
    );

    // --- 1.2. Добавляем EVM запросы в пакет ---
    protoMainnetPools.forEach(pool => {
        // Запрос на сумму стейкинга (deleg_amt)
        const delegAmtId = batchIdCounter++;
        let delegAmtData: `0x${string}`;
        let delegAmtAbi: Abi;

        if (pool.poolType === StakingPoolType.LIQUID) {
            delegAmtAbi = erc20Abi;
            delegAmtData = encodeFunctionData({
                abi: delegAmtAbi,
                functionName: 'balanceOf',
                args: [EVM_USER_ADDRESS],
            });
            batchRequests.push({
                jsonrpc: '2.0',
                method: 'eth_call',
                params: [{ to: pool.tokenAddress, data: delegAmtData }, 'latest'],
                id: delegAmtId,
            });
        } else { // NORMAL
            delegAmtAbi = nonLiquidDelegatorAbi;
            delegAmtData = encodeFunctionData({
                abi: delegAmtAbi,
                functionName: 'getDelegatedAmount',
            });
            batchRequests.push({
                jsonrpc: '2.0',
                method: 'eth_call',
                params: [{ to: pool.address, data: delegAmtData, from: EVM_USER_ADDRESS }, 'latest'],
                id: delegAmtId,
            });
        }
        evmRequestMap.set(String(delegAmtId), { pool, reqType: 'deleg_amt' });


        // Запрос на награды (только для NORMAL пулов)
        if (pool.poolType === StakingPoolType.NORMAL) {
            const rewardsId = batchIdCounter++;
            const rewardsAbi = nonLiquidDelegatorAbi;
            const rewardsData = encodeFunctionData({
                abi: rewardsAbi,
                functionName: 'rewards',
            });
            batchRequests.push({
                jsonrpc: '2.0',
                method: 'eth_call',
                params: [{ to: pool.address, data: rewardsData, from: EVM_USER_ADDRESS }, 'latest'],
                id: rewardsId,
            });
            evmRequestMap.set(String(rewardsId), { pool, reqType: 'rewards' });
        }
    });

    const allResults = await callJsonRPC(batchRequests);
    const resultsById = new Map<number, RpcResponse>();
    allResults.forEach(res => resultsById.set(res.id, res));


    // --- 3. Обработка результатов ---
    const finalOutput: FinalOutput[] = [];
    const tempEvmData = new Map<string, Partial<FinalOutput>>();

    // --- 3.1. Обработка EVM результатов ---
    for (const [id, res] of resultsById.entries()) {
        const reqInfo = evmRequestMap.get(String(id));
        if (!reqInfo) continue; // Это не EVM запрос, пропускаем

        const pool = reqInfo.pool;
        
        if (res.error || !res.result || res.result === "0x") {
            continue;
        }

        let decodedResult: any;
        try {
            if (reqInfo.reqType === 'deleg_amt') {
                 decodedResult = decodeFunctionResult({
                    abi: pool.poolType === 'LIQUID' ? erc20Abi : nonLiquidDelegatorAbi,
                    functionName: pool.poolType === 'LIQUID' ? 'balanceOf' : 'getDelegatedAmount',
                    data: res.result,
                });
            } else { // rewards
                 decodedResult = decodeFunctionResult({
                    abi: nonLiquidDelegatorAbi,
                    functionName: 'rewards',
                    data: res.result,
                });
            }
        } catch (e) {
            continue;
        }
        
        const value = BigInt(decodedResult ?? '0');

        if (value > 0n) {
            const entry = tempEvmData.get(pool.id) ?? {
                name: pool.name,
                url: "", // EVM пулы не имеют URL как SSN
                address: pool.address,
                tokenAddress: pool.tokenAddress,
                deleg_amt: 0n,
                rewards: 0n,
                tag: 'evm',
            };

            if (reqInfo.reqType === 'deleg_amt') {
                entry.deleg_amt = value;
            } else if (reqInfo.reqType === 'rewards') {
                entry.rewards = value;
            }
            tempEvmData.set(pool.id, entry);
        }
    }
    tempEvmData.forEach(data => {
        // Добавляем в итоговый массив только если есть стейк
        if (data.deleg_amt && data.deleg_amt > 0n) {
            finalOutput.push(data as FinalOutput);
        }
    });


    // --- 3.2. Обработка Scilla и Avely результатов ---
    const ssnResult = resultsById.get(SCILLA_ID_SSN_LIST);
    const rewardCycleResult = resultsById.get(SCILLA_ID_REWARD_CYCLE);
    const withdrawCycleResult = resultsById.get(SCILLA_ID_WITHDRAW_CYCLE);
    const stZilResult = resultsById.get(AVELY_ID_STZIL_BALANCE);

    // a) Обрабатываем Avely (stZIL)
    const stZilBalanceAmount = stZilResult?.result?.balances?.[SCILLA_USER_ADDRESS_LOWER];
    const stZilBalance = stZilBalanceAmount ? BigInt(stZilBalanceAmount) : 0n;
    if (stZilBalance > 0n) {
        finalOutput.push({
            name: "stZIL (Avely Finance)",
            url: "https://avely.fi/",
            address: ST_ZIL_CONTRACT,
            deleg_amt: stZilBalance,
            rewards: 0n, // Награды stZIL начисляются через рост курса
            tag: 'avely',
        });
    }

    // b) Обрабатываем Scilla SSN
    if (ssnResult?.result?.ssnlist) {
        const ssnlist = ssnResult.result['ssnlist'];
        const lastrewardcycle = BigInt(rewardCycleResult!.result[KEY_LAST_REWARD_CYCLE]);
        const lastWithdrawNodes = withdrawCycleResult!.result ? withdrawCycleResult!.result[KEY_LAST_WITHDRAW_CYCLE][SCILLA_USER_ADDRESS] : {};

        const ssnList: SSNode[] = Object.keys(ssnlist).map((key) => ({
            name: ssnlist[key].arguments[3],
            url: ssnlist[key].arguments[5],
            address: key,
            lastrewardcycle,
            lastWithdrawCcleDleg: lastWithdrawNodes[key] ? BigInt(lastWithdrawNodes[key]) : 0n,
        }));

        // --- 3.2.1. Второй пакетный запрос для получения стейков и наград Scilla ---
        // Этот шаг НЕОБХОДИМ, так как эти запросы зависят от результатов первого шага (списка нод).
        
        const delegAmtRequests: RpcRequest[] = ssnList.map((node, index) => ({
            jsonrpc: '2.0',
            method: 'GetSmartContractSubState',
            params: [SCILLA_GZIL_CONTRACT, 'ssn_deleg_amt', [node.address, SCILLA_USER_ADDRESS]],
            id: index,
        }));

        const delegAmtResults = await callJsonRPC(delegAmtRequests);
        let stakedScillaNodes: ScillaStakedNode[] = [];

        for (let i = 0; i < delegAmtResults.length; i++) {
            const delegations = delegAmtResults[i]?.result?.['ssn_deleg_amt']?.[ssnList[i].address]?.[SCILLA_USER_ADDRESS];
            if (delegations) {
                const amountQA = BigInt(delegations);
                if (amountQA > 0n) {
                    stakedScillaNodes.push({
                        node: ssnList[i],
                        deleg_amt: amountQA,
                        rewards: 0n,
                    });
                }
            }
        }
        
        if (stakedScillaNodes.length > 0) {
            // --- 3.2.2. Третий пакетный запрос для данных расчета наград Scilla ---
            const rewardDataRequests = stakedScillaNodes.flatMap((stakedNode, index) => [
                 { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'direct_deposit_deleg', [SCILLA_USER_ADDRESS_LOWER, stakedNode.node.address]], id: index * 4 + 1 },
                 { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'buff_deposit_deleg', [SCILLA_USER_ADDRESS_LOWER, stakedNode.node.address]], id: index * 4 + 2 },
                 { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'deleg_stake_per_cycle', [SCILLA_USER_ADDRESS_LOWER, stakedNode.node.address]], id: index * 4 + 3 },
                 { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'stake_ssn_per_cycle', [stakedNode.node.address]], id: index * 4 + 4 },
            ]);

            const rewardDataResults = await callJsonRPC(rewardDataRequests);
            
            stakedScillaNodes.forEach((node, i) => {
                const directRes = rewardDataResults[i * 4];
                const buffRes = rewardDataResults[i * 4 + 1];
                const delegCycleRes = rewardDataResults[i * 4 + 2];
                const stakeSsnCycleRes = rewardDataResults[i * 4 + 3];
                
                const direct_deposit_deleg_map = directRes?.result?.direct_deposit_deleg?.[SCILLA_USER_ADDRESS_LOWER]?.[node.node.address] || {};
                const buffer_deposit_deleg_map = buffRes?.result?.buff_deposit_deleg?.[SCILLA_USER_ADDRESS_LOWER]?.[node.node.address] || {};
                const deleg_stake_per_cycle_map = delegCycleRes?.result?.deleg_stake_per_cycle?.[SCILLA_USER_ADDRESS_LOWER]?.[node.node.address] || {};
                const stake_ssn_per_cycle_map = stakeSsnCycleRes?.result?.stake_ssn_per_cycle?.[node.node.address] || {};
        
                const reward_need_list = get_reward_need_cycle_list(node.node.lastWithdrawCcleDleg, node.node.lastrewardcycle);
                
                if (reward_need_list.length > 0) {
                    const delegate_per_cycle = combine_buff_direct(reward_need_list, direct_deposit_deleg_map, buffer_deposit_deleg_map, deleg_stake_per_cycle_map);
                    node.rewards = calculate_rewards(delegate_per_cycle, reward_need_list, stake_ssn_per_cycle_map);
                }
            });
            
            // Добавляем Scilla ноды в финальный результат
            stakedScillaNodes.forEach(sn => {
                finalOutput.push({
                    name: sn.node.name,
                    url: sn.node.url,
                    address: sn.node.address,
                    deleg_amt: sn.deleg_amt,
                    rewards: sn.rewards,
                    tag: 'scilla',
                });
            });
        }
    }
    
    console.log(finalOutput);

})().catch(console.error);
