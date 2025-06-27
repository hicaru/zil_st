import {
    encodeFunctionData,
    type Address,
    type Hex
} from 'viem';

// =======================
// === КОНСТАНТЫ ИЗ RUST ===
// =======================
const SCILLA_GZIL_CONTRACT = 'a7c67d49c82c7dc1b73d231640b2e4d0661d37c1';
const ST_ZIL_CONTRACT = 'e6f14afc8739a4ead0a542c07d3ff978190e3b92';
const DEPOSIT_ADDRESS: Address = '0x00000000005a494c4445504f53495450524f5859';

// ========================
// === ТИПЫ И ИНТЕРФЕЙСЫ ===
// ========================
interface RpcRequest {
    jsonrpc: string;
    method: string;
    params: any[];
    id: number;
}

enum StakingPoolType {
    LIQUID = 'LIQUID',
    NORMAL = 'NORMAL',
}

interface EvmPool {
    id: string;
    address: Address;
    tokenAddress: Address;
    name: string;
    poolType: StakingPoolType;
}

interface InitialCoreIds {
    ssnList: number;
    rewardCycle: number;
    withdrawCycle: number;
    stZilBalance: number;
    totalNetworkStake: number;
}

// ===================
// === ABI (такие же, как в основном файле) ===
// ===================
const depositAbi = [{
    inputs: [],
    name: "getFutureTotalStake",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
}] as const;

const erc20Abi = [{
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256', name: 'balance' }],
}] as const;

const nonLiquidDelegatorAbi = [{
    name: 'getDelegatedAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
}, {
    name: 'rewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
}] as const;

const evmDelegatorAbi = [{
    name: 'getCommission',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
}] as const;


// =========================
// === ФУНКЦИИ-КОНСТРУКТОРЫ ===
// =========================

function buildInitialCoreRequests(startId: number, scillaUserAddress: string): [RpcRequest[], InitialCoreIds, number] {
    const ids = {
        ssnList: startId++,
        rewardCycle: startId++,
        withdrawCycle: startId++,
        stZilBalance: startId++,
        totalNetworkStake: startId++,
    };

    const scillaUserAddressLower = scillaUserAddress.toLowerCase();
    const getFutureTotalStakeCallData = encodeFunctionData({ abi: depositAbi, functionName: 'getFutureTotalStake' });

    const requests: RpcRequest[] = [
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'ssnlist', []], id: ids.ssnList },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'lastrewardcycle', []], id: ids.rewardCycle },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [SCILLA_GZIL_CONTRACT, 'last_withdraw_cycle_deleg', [scillaUserAddress]], id: ids.withdrawCycle },
        { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [ST_ZIL_CONTRACT, 'balances', [scillaUserAddressLower]], id: ids.stZilBalance },
        { jsonrpc: '2.0', method: 'eth_call', params: [{ to: DEPOSIT_ADDRESS, data: getFutureTotalStakeCallData }, 'latest'], id: ids.totalNetworkStake }
    ];

    return [requests, ids, startId];
}

function buildEvmPoolsRequests(pools: EvmPool[], evmUserAddress: Address, startId: number): [RpcRequest[], Map<string, any>, number] {
    let currentId = startId;
    const requests: RpcRequest[] = [];
    const evmRequestMap = new Map();

    pools.forEach(pool => {
        // --- Запросы для пользователя ---
        const delegAmtId = currentId++;
        requests.push(pool.poolType === StakingPoolType.LIQUID
            ? { jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.tokenAddress, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [evmUserAddress] }) }, 'latest'], id: delegAmtId }
            : { jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: nonLiquidDelegatorAbi, functionName: 'getDelegatedAmount' }), from: evmUserAddress }, 'latest'], id: delegAmtId }
        );
        evmRequestMap.set(String(delegAmtId), { pool, reqType: 'deleg_amt' });

        if (pool.poolType === StakingPoolType.NORMAL) {
            const rewardsId = currentId++;
            requests.push({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: nonLiquidDelegatorAbi, functionName: 'rewards' }), from: evmUserAddress }, 'latest'], id: rewardsId });
            evmRequestMap.set(String(rewardsId), { pool, reqType: 'rewards' });
        }

        // --- Запросы для статистики пула (опускаем для соответствия Rust-тесту) ---
        // TVL
        currentId++;
        // PoolStake
        currentId++;

        const commissionId = currentId++;
        requests.push({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pool.address, data: encodeFunctionData({ abi: evmDelegatorAbi, functionName: 'getCommission' }) }, 'latest'], id: commissionId });
        evmRequestMap.set(String(commissionId), { pool, reqType: 'commission' });

    });
    
    return [requests, evmRequestMap, currentId];
}

// ===================
// === ТЕСТОВЫЙ КОД ===
// ===================

/**
 * Простая функция для глубокого сравнения объектов и массивов.
 */
function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (!keysB.includes(key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
}

/**
 * Функция для проверки и логирования.
 * @param description Описание проверки.
 * @param success Результат сравнения.
 */
function check(description: string, success: boolean) {
    if (success) {
        console.log(`  ✅ ${description}`);
    } else {
        console.error(`  ❌ ${description}`);
        // Выбрасываем ошибку, чтобы пометить тест как проваленный.
        throw new Error(`Check failed: ${description}`);
    }
}

/**
 * Простой исполнитель тестов.
 */
async function runTest(name: string, testFn: () => void | Promise<void>) {
    console.log(`\n--- Running test: ${name} ---`);
    try {
        await testFn();
        console.log(`👍 PASS: ${name}`);
    } catch (error) {
        console.error(`☠️ FAIL: ${name}`);
        // Логируем саму ошибку, чтобы видеть детали.
        console.error((error as Error).message);
    }
}

/**
 * Основная функция для запуска всех тестов.
 */
async function runAllTests() {
    console.log("🚀 Starting Stake Request Builder Tests...");

    await runTest('should build initial core requests correctly', () => {
        const scillaUserAddress = "0x77e27c39ce572283b848e2cdf32cce761e34fa49";
        const [requests, ids, next_id] = buildInitialCoreRequests(1, scillaUserAddress);

        check('Количество запросов должно быть 5', requests.length === 5);
        check('Следующий ID должен быть 6', next_id === 6);
        
        check('ID для ssnList корректен', ids.ssnList === 1);
        check('ID для rewardCycle корректен', ids.rewardCycle === 2);
        check('ID для withdrawCycle корректен', ids.withdrawCycle === 3);
        check('ID для stZilBalance корректен', ids.stZilBalance === 4);
        check('ID для totalNetworkStake корректен', ids.totalNetworkStake === 5);

        const req1 = requests[0];
        check('ID запроса 1 корректен', req1.id === 1);
        check('Метод запроса 1 корректен', req1.method === 'GetSmartContractSubState');
        check('Параметры запроса 1 корректны', deepEqual(req1.params, [SCILLA_GZIL_CONTRACT, "ssnlist", []]));

        const req3 = requests[2];
        check('ID запроса 3 корректен', req3.id === 3);
        check('Метод запроса 3 корректен', req3.method === 'GetSmartContractSubState');
        check('Параметры запроса 3 корректны', deepEqual(req3.params, [SCILLA_GZIL_CONTRACT, "last_withdraw_cycle_deleg", [scillaUserAddress]]));
        
        const req5 = requests[4];
        const getFutureTotalStakeCallData = encodeFunctionData({ abi: depositAbi, functionName: 'getFutureTotalStake' });
        check('ID запроса 5 корректен', req5.id === 5);
        check('Метод запроса 5 корректен', req5.method === 'eth_call');
        check('Адрес "to" в запросе 5 корректен', req5.params[0].to === DEPOSIT_ADDRESS);
        check('Данные "data" в запросе 5 корректны', req5.params[0].data === getFutureTotalStakeCallData);
    });

    await runTest('should build EVM pools requests correctly', () => {
        const pools: EvmPool[] = [
            {
                id: "MHhBMDU3",
                address: "0xA0572935d53e14C73eBb3de58d319A9Fe51E1FC8",
                tokenAddress: "0x0000000000000000000000000000000000000000",
                name: "Moonlet",
                poolType: StakingPoolType.NORMAL,
            },
            {
                id: "MHgyQWJl",
                address: "0x2Abed3a598CBDd8BB9089c09A9202FD80C55Df8c",
                tokenAddress: "0xD8B61fed51b9037A31C2Bf0a5dA4B717AF0C0F78",
                name: "AtomicWallet",
                poolType: StakingPoolType.LIQUID,
            },
        ];
        const evmUserAddress: Address = '0xb1fE20CD2b856BA1a4e08afb39dfF5C80f0cBbCa';
        const [requests] = buildEvmPoolsRequests(pools, evmUserAddress, 1);
        
        const totalExpectedRequests = 4;
        check(`Количество запросов должно быть ${totalExpectedRequests}`, requests.length === totalExpectedRequests);
        
        const moonletDelegReq = requests.find(r => r.id === 1);
        check('Запрос делегирования для Moonlet должен существовать', !!moonletDelegReq);
        const getDelegatedAmountCallData = encodeFunctionData({ abi: nonLiquidDelegatorAbi, functionName: 'getDelegatedAmount' });
        check('Данные для Moonlet deleg req корректны', moonletDelegReq!.params[0].data === getDelegatedAmountCallData);

        const moonletRewardsReq = requests.find(r => r.id === 2);
        check('Запрос наград для Moonlet должен существовать', !!moonletRewardsReq);

        const atomicDelegReq = requests.find(r => r.id === 5);
        check('Запрос делегирования для Atomic должен существовать', !!atomicDelegReq);
        const balanceOfCallData = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [evmUserAddress] });
        check('Адрес "to" для Atomic deleg req корректен', atomicDelegReq!.params[0].to === pools[1].tokenAddress);
        check('Данные для Atomic deleg req корректны', atomicDelegReq!.params[0].data === balanceOfCallData);
        
        const atomicRewardsReq = requests.find(r => r.id === 6);
        check('Запрос наград для Atomic не должен существовать', !atomicRewardsReq);
    });
    
    console.log("\n✨ All tests finished.");
}

// Запускаем все тесты
runAllTests();

