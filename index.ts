import { Zilliqa } from '@zilliqa-js/zilliqa';

// Конфигурация для Mainnet
const MAINNET_CONFIG = {
    api: 'https://api.zilliqa.com',
    impl: '0xa7C67D49C82c7dc1B73D231640B2e4d0661D37c1', // Mainnet staking contract
    chainId: 1
};

// Интерфейсы
interface NodeStakeInfo {
    ssnName: string;
    ssnAddress: string; // Адрес теперь в формате hex (0x...)
    stakeAmount: bigint;
    rewardsAmount: bigint;
    commissionRate: bigint;
    status: string;
}

interface BatchQueryResult {
    id: number;
    result: any;
}

// Интерфейс для данных, необходимых для расчета наград
interface RewardCalculationData {
    lastRewardCycle: number;
    lastWithdrawCycleMap: any;
    stakeSsnPerCycleMaps: { [ssnAddress: string]: any };
    directDepositMaps: { [ssnAddress: string]: any };
    buffDepositMaps: { [ssnAddress: string]: any };
    delegStakePerCycleMaps: { [ssnAddress: string]: any };
}


class ZilliqaStakeChecker {
    private zilliqa: Zilliqa;
    private implAddress: string;

    constructor() {
        this.zilliqa = new Zilliqa(MAINNET_CONFIG.api);
        this.implAddress = MAINNET_CONFIG.impl;
    }

    /**
     * Выполняет batch запрос к контракту
     */
    private async batchQuery(queries: Array<[string, string, any[]]>): Promise<BatchQueryResult[]> {
        if (queries.length === 0) return [];
        const startTime = performance.now();

        try {
            console.log(`🔍 Выполняется batch запрос (${queries.length} запросов)...`);
            
            const response = await this.zilliqa.blockchain.getSmartContractSubStateBatch(queries);
            
            if (!response.batch_result) {
                throw new Error('Неверный формат ответа от batch запроса');
            }

            const endTime = performance.now();
            console.log(`✅ Batch запрос выполнен за ${((endTime - startTime) / 1000).toFixed(2)}с`);
            
            // Сортируем результаты по ID для корректного порядка
            return response.batch_result.sort((a: any, b: any) => a.id - b.id);
            
        } catch (error) {
            console.error('❌ Ошибка в batch запросе:', error);
            throw error;
        }
    }

    /**
     * Конвертирует адрес в правильный формат (lowercase hex)
     */
    private normalizeAddress(address: string): string {
        // Простая проверка на формат hex-адреса (0x + 40 hex-символов)
        if (!/^0x[0-9a-f]{40}$/i.test(address)) {
            throw new Error(`Неверный формат адреса: ${address}. Ожидается hex-адрес формата 0x...`);
        }
        return address.toLowerCase();
    }

    /**
     * Рассчитывает невостребованные награды для всех узлов, используя BigInt.
     */
    private async calculateRewards(normalizedAddress: string, userDeposits: { [ssn: string]: string }, rewardData: RewardCalculationData): Promise<{ [ssnAddress: string]: bigint }> {
        console.log(`\n🧮 Расчет невостребованных наград (в Qa)...`);
        const rewardsBySsn: { [ssnAddress: string]: bigint } = {};

        for (const ssnAddress of Object.keys(userDeposits)) {
            let totalSsnReward = 0n; // Инициализация BigInt

            try {
                // 1. Определить циклы для расчета
                const lastWithdrawCycle = parseInt(rewardData.lastWithdrawCycleMap?.last_withdraw_cycle_deleg?.[normalizedAddress]?.[ssnAddress] || '0');
                const cyclesToCalculate = [];
                for (let i = lastWithdrawCycle + 1; i <= rewardData.lastRewardCycle; i++) {
                    cyclesToCalculate.push(i);
                }

                if (cyclesToCalculate.length === 0) {
                    rewardsBySsn[ssnAddress] = 0n;
                    continue;
                }

                // 2. Рассчитать эффективный стейк делегатора для каждого цикла
                const delegStakePerCycleMap = new Map<number, bigint>();
                const directMap = rewardData.directDepositMaps[ssnAddress]?.direct_deposit_deleg?.[normalizedAddress]?.[ssnAddress] || {};
                const buffMap = rewardData.buffDepositMaps[ssnAddress]?.buff_deposit_deleg?.[normalizedAddress]?.[ssnAddress] || {};

                for (let cycle = 1; cycle <= rewardData.lastRewardCycle; cycle++) {
                    const c1 = cycle - 1;
                    const c2 = cycle - 2;

                    const dir_amt = BigInt(directMap[c1.toString()] || 0);
                    const buf_amt = BigInt(buffMap[c2.toString()] || 0);
                    const last_amt = delegStakePerCycleMap.get(c1) || 0n;

                    const total_amt = last_amt + dir_amt + buf_amt;
                    delegStakePerCycleMap.set(cycle, total_amt);
                }

                // 3. Рассчитать и просуммировать награды за каждый необходимый цикл
                const ssnCycleInfoMap = rewardData.stakeSsnPerCycleMaps[ssnAddress]?.stake_ssn_per_cycle?.[ssnAddress] || {};

                for (const cycle of cyclesToCalculate) {
                    const cycleInfo = ssnCycleInfoMap[cycle];
                    if (!cycleInfo) continue;

                    const totalRewardsForCycle = BigInt(cycleInfo.arguments[1]);
                    const totalStakeForCycle = BigInt(cycleInfo.arguments[0]);
                    const delegStakeForCycle = delegStakePerCycleMap.get(cycle);

                    if (delegStakeForCycle && delegStakeForCycle > 0n && totalStakeForCycle > 0n) {
                        // Целочисленное деление, как и в смарт-контракте
                        const cycleReward = (delegStakeForCycle * totalRewardsForCycle) / totalStakeForCycle;
                        totalSsnReward += cycleReward;
                    }
                }
            } catch (e) {
                console.error(`- Ошибка при расчете наград для узла ${ssnAddress}:`, e);
                totalSsnReward = 0n;
            }

            rewardsBySsn[ssnAddress] = totalSsnReward;
        }
        
        console.log(`✅ Расчет наград завершен.`);
        return rewardsBySsn;
    }

    /**
     * Получает все узлы с активным стейком для указанного адреса
     */
    async getStakedNodes(walletAddress: string): Promise<NodeStakeInfo[]> {
        console.log(`\n🚀 Поиск стейков для адреса: ${walletAddress}`);
        
        const normalizedAddress = this.normalizeAddress(walletAddress);
        console.log(`📍 Нормализованный адрес: ${normalizedAddress}`);

        const initialQueries: Array<[string, string, any[]]> = [
            [this.implAddress, 'deposit_amt_deleg', [normalizedAddress]],
            [this.implAddress, 'ssnlist', []],
            [this.implAddress, 'lastrewardcycle', []],
            [this.implAddress, 'last_withdraw_cycle_deleg', [normalizedAddress]],
        ];

        try {
            const initialResults = await this.batchQuery(initialQueries);
            
            const depositsResult = initialResults[0]?.result;
            const ssnListResult = initialResults[1]?.result;
            const lastRewardCycleResult = initialResults[2]?.result;
            const lastWithdrawResult = initialResults[3]?.result;

            if (!depositsResult || !ssnListResult || !lastRewardCycleResult) {
                throw new Error('Не удалось получить основные данные из контракта');
            }

            const userDeposits = depositsResult.deposit_amt_deleg?.[normalizedAddress];
            
            if (!userDeposits || Object.keys(userDeposits).length === 0) {
                console.log('❌ У данного адреса нет активных стейков');
                return [];
            }
            
            const ssnList = ssnListResult.ssnlist;
            if (!ssnList) throw new Error('Не удалось получить список узлов');

            // --- Подготовка и выполнение ВТОРОГО batch-запроса для данных по циклам ---
            const rewardQueries: Array<[string, string, any[]]> = [];
            const stakedSsnAddresses = Object.keys(userDeposits);

            for (const ssnAddr of stakedSsnAddresses) {
                rewardQueries.push([this.implAddress, 'stake_ssn_per_cycle', [ssnAddr]]);
                rewardQueries.push([this.implAddress, 'direct_deposit_deleg', [normalizedAddress, ssnAddr]]);
                rewardQueries.push([this.implAddress, 'buff_deposit_deleg', [normalizedAddress, ssnAddr]]);
                rewardQueries.push([this.implAddress, 'deleg_stake_per_cycle', [normalizedAddress, ssnAddr]]);
            }

            const rewardQueryResults = await this.batchQuery(rewardQueries);
            
            const rewardData: RewardCalculationData = {
                lastRewardCycle: parseInt(lastRewardCycleResult.lastrewardcycle),
                lastWithdrawCycleMap: lastWithdrawResult,
                stakeSsnPerCycleMaps: {},
                directDepositMaps: {},
                buffDepositMaps: {},
                delegStakePerCycleMaps: {},
            };
            
            let queryIndex = 0;
            for (const ssnAddr of stakedSsnAddresses) {
                rewardData.stakeSsnPerCycleMaps[ssnAddr] = rewardQueryResults[queryIndex++]?.result;
                rewardData.directDepositMaps[ssnAddr] = rewardQueryResults[queryIndex++]?.result;
                rewardData.buffDepositMaps[ssnAddr] = rewardQueryResults[queryIndex++]?.result;
                rewardData.delegStakePerCycleMaps[ssnAddr] = rewardQueryResults[queryIndex++]?.result;
            }
            
            // Рассчитываем награды
            const rewardsBySsn = await this.calculateRewards(normalizedAddress, userDeposits, rewardData);

            console.log(`\n📊 Найдено стейков на ${Object.keys(userDeposits).length} узлах:`);
            console.log('=' + '='.repeat(80));

            const stakedNodes: NodeStakeInfo[] = [];
            let totalStaked = 0n;
            let totalRewards = 0n;

            for (const [ssnAddress, stakeAmountStr] of Object.entries(userDeposits)) {
                const ssnInfo = ssnList[ssnAddress];
                
                if (!ssnInfo) {
                    console.log(`⚠️  Узел 0x${ssnAddress} не найден в списке`);
                    continue;
                }

                const ssnArgs = ssnInfo.arguments;
                const ssnName = ssnArgs[3] || 'Неизвестно';
                const commissionRate = BigInt(ssnArgs[7] || '0'); // Комиссия как BigInt
                const isActive = ssnArgs[0]?.constructor === 'True';
                const status = isActive ? 'Активен' : 'Неактивен';
                
                const stakeAmount = BigInt(stakeAmountStr as string);
                const rewardsAmount = rewardsBySsn[ssnAddress] || 0n;
                
                totalStaked += stakeAmount;
                totalRewards += rewardsAmount;

                const nodeInfo: NodeStakeInfo = {
                    ssnName,
                    ssnAddress: `0x${ssnAddress}`, // Отображаем как hex
                    stakeAmount,
                    rewardsAmount,
                    commissionRate,
                    status
                };

                stakedNodes.push(nodeInfo);

                // Выводим информацию в целочисленном виде
                console.log(`\n🎯 Узел: ${ssnName}`);
                console.log(`   📍 Адрес: 0x${ssnAddress}`);
                console.log(`   💰 Стейк (Qa): ${stakeAmount.toString()}`);
                console.log(`   🎁 Награды (Qa): ${rewardsAmount.toString()}`);
                console.log(`   💹 Комиссия (10^7): ${commissionRate.toString()}`);
                console.log(`   📊 Статус: ${status}`);
            }

            // Выводим общую статистику
            console.log('\n' + '=' + '='.repeat(80));
            console.log(`📈 ОБЩАЯ СТАТИСТИКА:`);
            console.log(`   🎯 Всего узлов со стейком: ${stakedNodes.length}`);
            console.log(`   💰 Общая сумма стейка (Qa): ${totalStaked.toString()}`);
            console.log(`   🎁 Общая сумма невостребованных наград (Qa): ${totalRewards.toString()}`);
            console.log(`   🌐 Сеть: Mainnet`);
            console.log('=' + '='.repeat(80));

            return stakedNodes;

        } catch (error) {
            console.error('❌ Ошибка при получении стейков:', error);
            throw error;
        }
    }
}


// Основная функция
async function main() {
    console.log('🔥 Zilliqa Staking Checker v2.1 (Base16 Edition)\n');
    
    // Получаем адрес из аргументов командной строки.
    // Адрес zil1ruzwjhykmxlugf5a2wlm78z9cjv0u3rt0e84w2 в hex-формате
    const walletAddress = "0x1f04E95C96D9BFC4269D53bfBf1c45C498FE446B";
    
    if (!walletAddress) {
        console.error('❌ Ошибка: Укажите адрес кошелька');
        console.log('📝 Использование: bun run src/index.ts <wallet_address>');
        console.log('📝 Пример: bun run src/index.ts 0x2b5c2ea7e1458e72c85116a4f358b5e43c5b98a2');
        process.exit(1);
    }

    try {
        const checker = new ZilliqaStakeChecker();
        const stakedNodes = await checker.getStakedNodes(walletAddress);
        
        if (stakedNodes.length === 0) {
            console.log('\n🤷 На данном адресе нет активных стейков');
        } else {
            console.log(`\n✅ Успешно получена информация о ${stakedNodes.length} узлах с активным стейком!`);
        }
        
    } catch (error) {
        console.error('\n💥 Критическая ошибка:', error);
        process.exit(1);
    }
}

// Обработка необработанных ошибок
process.on('unhandledRejection', (error) => {
    console.error('💥 Необработанная ошибка:', error);
    process.exit(1);
});

// Запускаем программу
main().catch(console.error);
