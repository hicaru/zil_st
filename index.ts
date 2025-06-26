import fetch from 'node-fetch';

const KEY_LAST_REWARD_CYCLE = 'lastrewardcycle';
const KEY_LAST_WITHDRAW_CYCLE = 'last_withdraw_cycle_deleg';
const KEY_BALANCE_ZRC2 = 'balances';

interface RpcRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

interface SSNode {
  name: string;
  url: string;
  address: string;
  lastrewardcycle: bigint;
  lastWithdrawCcleDleg: bigint;
}

interface StakedNode {
  node: SSNode;
  amount: bigint;
  direct_deposit: bigint;
  buffer_deposit: bigint;
  deleg_stake_per_cycle: bigint;
  stake_ssn_per_cycle: bigint;
  rewards: bigint;
  stzil: bigint;
}

// === Конфиг ===
const RPC_URL = 'http://188.234.213.4:4202';
const CONTRACT_IMPL = 'a7C67D49C82c7dc1B73D231640B2e4d0661D37c1';
const ST_ZIL_IMPL = 'e6f14afc8739a4ead0a542c07d3ff978190e3b92';
const USER_ADDRESS = '0x77e27c39ce572283b848e2cdf32cce761e34fa49';

async function callJsonRPC(requests: RpcRequest[]): Promise<any> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
  });

  return await response.json();
}

async function getSSNList(): Promise<SSNode[]> {
  const batchRequests: RpcRequest[] = [
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'ssnlist', []],
      id: 1,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, KEY_LAST_REWARD_CYCLE, []],
      id: 2,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, KEY_LAST_WITHDRAW_CYCLE, [USER_ADDRESS]],
      id: 3,
    },
  ];

  const results = await callJsonRPC(batchRequests);
  const ssnlist = results[0].result['ssnlist'];
  const lastrewardcycle = BigInt(results[1].result[KEY_LAST_REWARD_CYCLE]);
  const lastWithdrawNodes = results[2].result[KEY_LAST_WITHDRAW_CYCLE][USER_ADDRESS];

  return Object.keys(ssnlist).map((key) => ({
    lastrewardcycle,
    lastWithdrawCcleDleg: lastWithdrawNodes[key] ? BigInt(lastWithdrawNodes[key]) : 0n,
    name: ssnlist[key].arguments[3],
    url: ssnlist[key].arguments[5],
    address: key,
  }));
}

async function getStakedNodesForUser(ssns: SSNode[]): Promise<StakedNode[]> {
  const KEY = 'ssn_deleg_amt';
  const batchRequests: RpcRequest[] = ssns.map((node, index) => ({
    jsonrpc: '2.0',
    method: 'GetSmartContractSubState',
    params: [CONTRACT_IMPL, KEY, [node.address, USER_ADDRESS]],
    id: index + 2,
  }));

  const results = await callJsonRPC(batchRequests);
  const stakedNodes: StakedNode[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const node = ssns[i];

    if (!result || !result.result || !result.result[KEY]) {
      continue;
    }

    const delegations = result.result[KEY][node.address][USER_ADDRESS];
    const amountQA = BigInt(delegations);

    if (amountQA > 0n) {
      stakedNodes.push({
        node: node,
        amount: amountQA,
        direct_deposit: 0n,
        buffer_deposit: 0n,
        deleg_stake_per_cycle: 0n,
        rewards: 0n,
        stake_ssn_per_cycle: 0n,
        stzil: 0n,
      });
    }
  }

  return stakedNodes;
}

async function getRewardRelatedDataBatch(stakedNodes: StakedNode[]): Promise<StakedNode[]> {
  const USER_ADDRESS_LOWER = USER_ADDRESS.toLowerCase();
  const batchRequests: RpcRequest[] = stakedNodes.flatMap((node, index) => [
    // Три существующих запроса
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'direct_deposit_deleg', [USER_ADDRESS_LOWER, node.node.address]],
      id: index * 5 + 1,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'buff_deposit_deleg', [USER_ADDRESS_LOWER, node.node.address]],
      id: index * 5 + 2,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'deleg_stake_per_cycle', [USER_ADDRESS_LOWER, node.node.address]],
      id: index * 5 + 3,
    }, // Два новых запроса
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'stake_ssn_per_cycle', [node.node.address]],
      id: index * 5 + 4,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'deleg_stake_per_cycle', [USER_ADDRESS_LOWER, node.node.address]],
      id: index * 5 + 5,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [ST_ZIL_IMPL, KEY_BALANCE_ZRC2, [USER_ADDRESS]],
      id: index * 5 + 6,
    },
  ]);

  const results = await callJsonRPC(batchRequests);

  for (let i = 0; i < stakedNodes.length; i++) {
    const directRes = results[i * 6];     // индекс 0
    const buffRes = results[i * 6 + 1];   // индекс 1
    const cycleRes = results[i * 6 + 2];  // индекс 2
    const stakeSsnCycleRes = results[i * 6 + 3];  // индекс 3
    const delegCycleRes2 = results[i * 6 + 4];    // индекс 4
    const zrc2BalanceRes = results[i * 6 + 5];    // индекс 5 — НОВОЕ

    const keyDirect = 'direct_deposit_deleg';
    const keyBuff = 'buff_deposit_deleg';
    const keyCycle = 'deleg_stake_per_cycle';
    const keyStakeSsnCycle = 'stake_ssn_per_cycle';

    try {
      // --- Обработка direct_deposit ---
      if (
        directRes?.result &&
        directRes.result[keyDirect] &&
        directRes.result[keyDirect][USER_ADDRESS_LOWER]?.[stakedNodes[i].node.address]
      ) {
        const deposits = directRes.result[keyDirect][USER_ADDRESS_LOWER][stakedNodes[i].node.address];
        const lastKey = Object.keys(deposits).sort().pop();
        if (lastKey) {
          stakedNodes[i].direct_deposit = BigInt(deposits[lastKey]);
        }
      }

      // --- Обработка buffer_deposit ---
      if (
        buffRes?.result &&
        buffRes.result[keyBuff] &&
        buffRes.result[keyBuff][USER_ADDRESS_LOWER]?.[stakedNodes[i].node.address]
      ) {
        const deposits = buffRes.result[keyBuff][USER_ADDRESS_LOWER][stakedNodes[i].node.address];
        const lastKey = Object.keys(deposits).sort().pop();
        if (lastKey) {
          stakedNodes[i].buffer_deposit = BigInt(deposits[lastKey]);
        }
      }

      // --- Обработка deleg_stake_per_cycle (первый запрос) ---
      if (
        cycleRes?.result &&
        cycleRes.result[keyCycle] &&
        cycleRes.result[keyCycle][USER_ADDRESS_LOWER]?.[stakedNodes[i].node.address]
      ) {
        const deposits = cycleRes.result[keyCycle][USER_ADDRESS_LOWER][stakedNodes[i].node.address];
        const lastKey = Object.keys(deposits).sort().pop();
        if (lastKey) {
          stakedNodes[i].deleg_stake_per_cycle = BigInt(deposits[lastKey]);
        }
      }

      // --- Обработка stake_ssn_per_cycle ---
      if (
        stakeSsnCycleRes?.result &&
        stakeSsnCycleRes.result[keyStakeSsnCycle]?.[stakedNodes[i].node.address]
      ) {
        const ssnCycleData = stakeSsnCycleRes.result[keyStakeSsnCycle][stakedNodes[i].node.address];
        const lastKey = Object.keys(ssnCycleData).sort().pop();
        if (lastKey) {
          const totalStake = BigInt(ssnCycleData[lastKey].arguments[0]);
          stakedNodes[i].stake_ssn_per_cycle = totalStake;
        }
      }

      // --- Обработка deleg_stake_per_cycle (второй запрос) ---
      if (
        delegCycleRes2?.result &&
        delegCycleRes2.result[keyCycle] &&
        delegCycleRes2.result[keyCycle][USER_ADDRESS_LOWER]?.[stakedNodes[i].node.address]
      ) {
        const deposits = delegCycleRes2.result[keyCycle][USER_ADDRESS_LOWER][stakedNodes[i].node.address];
        const lastKey = Object.keys(deposits).sort().pop();
        if (lastKey) {
          stakedNodes[i].deleg_stake_per_cycle = BigInt(deposits[lastKey]);
        }
      }

      if (
        zrc2BalanceRes?.result &&
        zrc2BalanceRes.result[KEY_BALANCE_ZRC2] &&
        zrc2BalanceRes.result[KEY_BALANCE_ZRC2][USER_ADDRESS]
      ) {
        const balance = zrc2BalanceRes.result[KEY_BALANCE_ZRC2][USER_ADDRESS];
        stakedNodes[i].stzil = BigInt(balance || 0);
      } else {
        stakedNodes[i].stzil = 0n;
      }

    } catch (e) {
      console.error(`Ошибка при обработке данных для ноды ${stakedNodes[i].node.name}:`, e);
    }
  }

  return stakedNodes;
}

(async function () {
  const list = await getSSNList();
  const staked = await getStakedNodesForUser(list);

  await getRewardRelatedDataBatch(staked);

  console.log(staked);
}())
