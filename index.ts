import fetch from 'node-fetch';

// Main configuration remains the same
// === Конфиг ===
const RPC_URL = 'http://188.234.213.4:4202';
const CONTRACT_IMPL = 'a7C67D49C82c7dc1B73D231640B2e4d0661D37c1';
const USER_ADDRESS = '0x77e27c39ce572283b848e2cdf32cce761e34fa49';
const USER_ADDRESS_LOWER = USER_ADDRESS.toLowerCase();

// Constants for RPC calls
const KEY_LAST_REWARD_CYCLE = 'lastrewardcycle';
const KEY_LAST_WITHDRAW_CYCLE = 'last_withdraw_cycle_deleg';

// --- Interfaces (Определения типов) ---

interface RpcRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

// Basic information about a Seed Node (SSN)
interface SSNode {
  name: string;
  url: string;
  address: string;
  lastrewardcycle: bigint;
  lastWithdrawCcleDleg: bigint;
}

// Final, clean data structure for a user's staked node
interface StakedNode {
  node: SSNode;
  deleg_amt: bigint;
  rewards: bigint; // This will be calculated and added
}

// A temporary, internal structure to hold all fetched data for a node before calculation
interface StakedNodeWithData extends StakedNode {
    direct_deposit_deleg_map: Record<string, string>;
    buffer_deposit_deleg_map: Record<string, string>;
    deleg_stake_per_cycle_map: Record<string, string>;
    stake_ssn_per_cycle_map: Record<string, { arguments: [string, string] }>;
}


// --- RPC and Data Fetching Functions (Функции для работы с RPC) ---

async function callJsonRPC(requests: RpcRequest[]): Promise<any[]> {
  if (requests.length === 0) {
    return [];
  }
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
  });
  return response.json();
}

async function getSSNList(): Promise<SSNode[]> {
  const batchRequests: RpcRequest[] = [
    { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [CONTRACT_IMPL, 'ssnlist', []], id: 1 },
    { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [CONTRACT_IMPL, KEY_LAST_REWARD_CYCLE, []], id: 2 },
    { jsonrpc: '2.0', method: 'GetSmartContractSubState', params: [CONTRACT_IMPL, KEY_LAST_WITHDRAW_CYCLE, [USER_ADDRESS]], id: 3 },
  ];

  const [ssnResult, rewardCycleResult, withdrawCycleResult] = await callJsonRPC(batchRequests);
  
  const ssnlist = ssnResult.result['ssnlist'];
  const lastrewardcycle = BigInt(rewardCycleResult.result[KEY_LAST_REWARD_CYCLE]);
  const lastWithdrawNodes = withdrawCycleResult.result ? withdrawCycleResult.result[KEY_LAST_WITHDRAW_CYCLE][USER_ADDRESS] : {};

  return Object.keys(ssnlist).map((key) => ({
    name: ssnlist[key].arguments[3],
    url: ssnlist[key].arguments[5],
    address: key,
    lastrewardcycle,
    lastWithdrawCcleDleg: lastWithdrawNodes[key] ? BigInt(lastWithdrawNodes[key]) : 0n,
  }));
}

async function getStakedNodesForUser(ssns: SSNode[]): Promise<StakedNode[]> {
  const KEY = 'ssn_deleg_amt';
  const batchRequests: RpcRequest[] = ssns.map((node, index) => ({
    jsonrpc: '2.0',
    method: 'GetSmartContractSubState',
    params: [CONTRACT_IMPL, KEY, [node.address, USER_ADDRESS]],
    id: index,
  }));

  const results = await callJsonRPC(batchRequests);
  const stakedNodes: StakedNode[] = [];

  for (let i = 0; i < results.length; i++) {
    const delegations = results[i]?.result?.[KEY]?.[ssns[i].address]?.[USER_ADDRESS];
    if (delegations) {
      const amountQA = BigInt(delegations);
      if (amountQA > 0n) {
        stakedNodes.push({
          node: ssns[i],
          deleg_amt: amountQA,
          rewards: 0n, // Initialize rewards
        });
      }
    }
  }
  return stakedNodes;
}

async function fetchAllRewardData(stakedNodes: StakedNode[]): Promise<any[]> {
    const batchRequests = stakedNodes.flatMap((stakedNode, index) => [
        {
            jsonrpc: '2.0',
            method: 'GetSmartContractSubState',
            params: [CONTRACT_IMPL, 'direct_deposit_deleg', [USER_ADDRESS_LOWER, stakedNode.node.address]],
            id: index * 4 + 1,
        },
        {
            jsonrpc: '2.0',
            method: 'GetSmartContractSubState',
            params: [CONTRACT_IMPL, 'buff_deposit_deleg', [USER_ADDRESS_LOWER, stakedNode.node.address]],
            id: index * 4 + 2,
        },
        {
            jsonrpc: '2.0',
            method: 'GetSmartContractSubState',
            params: [CONTRACT_IMPL, 'deleg_stake_per_cycle', [USER_ADDRESS_LOWER, stakedNode.node.address]],
            id: index * 4 + 3,
        },
        {
            jsonrpc: '2.0',
            method: 'GetSmartContractSubState',
            params: [CONTRACT_IMPL, 'stake_ssn_per_cycle', [stakedNode.node.address]],
            id: index * 4 + 4,
        },
    ]);

    return callJsonRPC(batchRequests);
}

// --- Calculation Logic (Логика расчетов) ---
// These functions are mostly unchanged as their logic is specific to the Zillion protocol.

function get_reward_need_cycle_list(last_withdraw_cycle: bigint, last_reward_cycle: bigint): number[] {
    const cycles: number[] = [];
    if (last_reward_cycle <= last_withdraw_cycle) {
        return [];
    }
    for (let i = Number(last_withdraw_cycle) + 1; i <= Number(last_reward_cycle); i++) {
        cycles.push(i);
    }
    return cycles;
}

function combine_buff_direct(
    reward_list: number[],
    direct_deposit_map: Record<string, string>,
    buffer_deposit_map: Record<string, string>,
    deleg_stake_per_cycle_map: Record<string, string>
): Map<number, bigint> {
    const result_map = new Map<number, bigint>();
    let last_amt = 0n;

    for (const cycle of reward_list) {
        const c1 = cycle - 1;
        const c2 = cycle - 2;

        const hist_amt = BigInt(deleg_stake_per_cycle_map[c1.toString()] ?? '0');
        const dir_amt = BigInt(direct_deposit_map[c1.toString()] ?? '0');
        const buf_amt = BigInt(buffer_deposit_map[c2.toString()] ?? '0');
        
        // This logic appears to be cumulative based on your original code
        // If it's not cumulative, the `+ last_amt` should be removed.
        const total_amt_tmp = dir_amt + buf_amt + hist_amt;
        const previous_cycle_amt = result_map.get(c1) ?? 0n;
        const total_amt = total_amt_tmp + previous_cycle_amt;

        result_map.set(cycle, total_amt);
    }
    return result_map;
}


function calculate_rewards(
    delegate_per_cycle: Map<number, bigint>,
    need_list: number[],
    stake_ssn_per_cycle_map: Record<string, { arguments: [string, string] }>
): bigint {
    let result_rewards = 0n;

    if (!stake_ssn_per_cycle_map) {
        return result_rewards;
    }

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


// --- Main Execution (Основное выполнение) ---

(async function main() {
  console.log('1. Fetching full SSN list...');
  const allSsn = await getSSNList();

  console.log(`2. Finding nodes staked by user ${USER_ADDRESS}...`);
  let stakedNodes = await getStakedNodesForUser(allSsn);

  if (stakedNodes.length === 0) {
    console.log('User has no staked nodes. Exiting.');
    return;
  }
  
  console.log(`Found ${stakedNodes.length} staked node(s).`);
  console.log('3. Fetching all reward-related data in a single batch...');
  const rewardDataResults = await fetchAllRewardData(stakedNodes);

  console.log('4. Calculating rewards for each node...');
  stakedNodes.forEach((node, i) => {
    // Extract the temporary data for this specific node from the batch results
    const directRes = rewardDataResults[i * 4];
    const buffRes = rewardDataResults[i * 4 + 1];
    const delegCycleRes = rewardDataResults[i * 4 + 2];
    const stakeSsnCycleRes = rewardDataResults[i * 4 + 3];

    // These maps are now temporary variables, not properties of the node object
    const direct_deposit_deleg_map = directRes?.result?.direct_deposit_deleg?.[USER_ADDRESS_LOWER]?.[node.node.address] || {};
    const buffer_deposit_deleg_map = buffRes?.result?.buff_deposit_deleg?.[USER_ADDRESS_LOWER]?.[node.node.address] || {};
    const deleg_stake_per_cycle_map = delegCycleRes?.result?.deleg_stake_per_cycle?.[USER_ADDRESS_LOWER]?.[node.node.address] || {};
    const stake_ssn_per_cycle_map = stakeSsnCycleRes?.result?.stake_ssn_per_cycle?.[node.node.address] || {};

    const reward_need_list = get_reward_need_cycle_list(
        node.node.lastWithdrawCcleDleg,
        node.node.lastrewardcycle,
    );
    
    if (reward_need_list.length > 0) {
        const delegate_per_cycle = combine_buff_direct(
            reward_need_list,
            direct_deposit_deleg_map,
            buffer_deposit_deleg_map,
            deleg_stake_per_cycle_map
        );
    
        const rewards = calculate_rewards(
            delegate_per_cycle,
            reward_need_list,
            stake_ssn_per_cycle_map
        );
    
        // Assign the final calculated value.
        node.rewards = rewards;
    }
  });
  
  console.log('\n--- Calculation Complete ---');

  // Create the final, clean output object as requested
  const finalOutput = stakedNodes.map(sn => ({
      name: sn.node.name,
      url: sn.node.url,
      address: sn.node.address,
      deleg_amt: sn.deleg_amt,
      rewards: sn.rewards,
  }));

  console.log(finalOutput);

})().catch(console.error);
