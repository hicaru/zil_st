import fetch from 'node-fetch';

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
}

interface StakedNode {
  node: SSNode;
  amount: bigint;
}

// === Конфиг ===
const RPC_URL = 'http://188.234.213.4:4202';
const CONTRACT_IMPL = 'a7C67D49C82c7dc1B73D231640B2e4d0661D37c1';
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
  ];

  const results = await callJsonRPC(batchRequests);
  const ssnlist = results[0].result['ssnlist'];

  return Object.keys(ssnlist).map((key) => ({
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
      });
    }
  }

  return stakedNodes;
}

async function getRewardRelatedDataBatch(
  userAddress: string,
  ssnAddress: string,
): Promise<any> {
  const batchRequests: RpcRequest[] = [
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'direct_deposit_deleg', [userAddress, ssnAddress]],
      id: 1,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'buff_deposit_deleg', [userAddress, ssnAddress]],
      id: 2,
    },
    {
      jsonrpc: '2.0',
      method: 'GetSmartContractSubState',
      params: [CONTRACT_IMPL, 'deleg_stake_per_cycle', [userAddress, ssnAddress]],
      id: 3,
    }
  ];

  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchRequests),
  });
  const result = await response.json();

  console.log(result);

}

(async function () {
  const list = await getSSNList();
  const staked = await getStakedNodesForUser(list);

  await getRewardRelatedDataBatch(USER_ADDRESS, "0xc3ed69338765424f4771dd636a5d3bfa0a776a35");

  console.log(staked);
}())
