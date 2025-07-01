#!/usr/bin/env bun

import { Zilliqa } from '@zilliqa-js/zilliqa';
import { toBech32Address, fromBech32Address } from '@zilliqa-js/crypto';
import { validation, units, BN } from '@zilliqa-js/util';
import { BigNumber } from 'bignumber.js';

// Конфигурация для Mainnet
const MAINNET_CONFIG = {
    api: 'https://api.zilliqa.com',
    impl: '0xa7C67D49C82c7dc1B73D231640B2e4d0661D37c1', // Mainnet staking contract
    chainId: 1
};

// Интерфейсы
interface NodeStakeInfo {
    ssnName: string;
    ssnAddress: string;
    stakeAmount: string;
    stakeAmountZil: string;
    rewardsZil: string; // <<< ДОБАВЛЕНО
    commissionRate: string;
    status: string;
}

interface BatchQueryResult {
    id: number;
    result: any;
}

// <<< НАЧАЛО: Логика расчета вознаграждений, адаптированная из Zillion
interface RewardCalculationData {
    lastRewardCycle: number;
    lastWithdrawCycleMap: any;
    stakeSsnPerCycleMaps: { [ssnAddress: string]: any };
    directDepositMaps: { [ssnAddress: string]: any };
    buffDepositMaps: { [ssnAddress: string]: any };
    delegStakePerCycleMaps: { [ssnAddress: string]: any };
}
// <<< КОНЕЦ: Логика расчета вознаграждений, адаптированная из Zillion


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
     * Конвертирует адрес в правильный формат
     */
    private normalizeAddress(address: string): string {
        if (validation.isBech32(address)) {
            return fromBech32Address(address).toLowerCase();
        }
        if (validation.isAddress(address)) {
            return address.toLowerCase();
        }
        throw new Error(`Неверный формат адреса: ${address}`);
    }

    /**
     * Конвертирует Qa в ZIL с форматированием
     */
    private formatZilAmount(qaAmount: string): string {
        if (!qaAmount || qaAmount === '0') return '0.000';
        const zil = units.fromQa(new BN(qaAmount), units.Units.Zil);
        const zilBN = new BigNumber(zil);
        const formatted = zilBN.toFixed(3);
        const parts = formatted.split('.');
        const formattedInteger = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${formattedInteger}.${parts[1]}`;
    }

    /**
     * Конвертирует комиссию из формата контракта в проценты
     */
    private formatCommissionRate(rate: string): string {
        if (!rate) return '0.00';
        const commRate = new BigNumber(rate).dividedBy(10**7);
        return commRate.toFixed(2);
    }

    // <<< НАЧАЛО: Новая функция для расчета наград
    /**
     * Рассчитывает невостребованные награды для всех узлов.
     * Эта функция воспроизводит логику из проекта Zillion.
     */
    private async calculateRewards(normalizedAddress: string, userDeposits: { [ssn: string]: string }, rewardData: RewardCalculationData): Promise<{ [ssnAddress: string]: BN }> {
        console.log(`\n🧮 Расчет невостребованных наград...`);
        const rewardsBySsn: { [ssnAddress: string]: BN } = {};

        for (const ssnAddress of Object.keys(userDeposits)) {
            let totalSsnReward = new BN(0);

            try {
                // 1. Определить циклы для расчета
                const lastWithdrawCycle = parseInt(rewardData.lastWithdrawCycleMap?.last_withdraw_cycle_deleg?.[normalizedAddress]?.[ssnAddress] || '0');
                const cyclesToCalculate = [];
                for (let i = lastWithdrawCycle + 1; i <= rewardData.lastRewardCycle; i++) {
                    cyclesToCalculate.push(i);
                }

                if (cyclesToCalculate.length === 0) {
                    rewardsBySsn[ssnAddress] = new BN(0);
                    continue;
                }

                // 2. Рассчитать эффективный стейк делегатора для каждого цикла
                const delegStakePerCycleMap = new Map<number, BN>();
                const directMap = rewardData.directDepositMaps[ssnAddress]?.direct_deposit_deleg?.[normalizedAddress]?.[ssnAddress] || {};
                const buffMap = rewardData.buffDepositMaps[ssnAddress]?.buff_deposit_deleg?.[normalizedAddress]?.[ssnAddress] || {};
                const historyMap = rewardData.delegStakePerCycleMaps[ssnAddress]?.deleg_stake_per_cycle?.[normalizedAddress]?.[ssnAddress] || {};

                for (let cycle = 1; cycle <= rewardData.lastRewardCycle; cycle++) {
                    const c1 = cycle - 1;
                    const c2 = cycle - 2;

                    const hist_amt = new BN(historyMap[c1.toString()] || 0);
                    const dir_amt = new BN(directMap[c1.toString()] || 0);
                    const buf_amt = new BN(buffMap[c2.toString()] || 0);
                    
                    const last_amt = delegStakePerCycleMap.get(c1) || new BN(0);

                    // Важно: в Zillion логике исторический стейк не суммируется с предыдущим, а заменяет его.
                    // Логика такая: total = previous_total + direct + buffered.
                    // Но `deleg_stake_per_cycle` уже хранит итоговую сумму за предыдущий цикл.
                    // Поэтому `hist_amt` это и есть `last_amt`. Используем `last_amt`.
                    const total_amt = last_amt.add(dir_amt).add(buf_amt);
                    delegStakePerCycleMap.set(cycle, total_amt);
                }

                // 3. Рассчитать и просуммировать награды за каждый необходимый цикл
                const ssnCycleInfoMap = rewardData.stakeSsnPerCycleMaps[ssnAddress]?.stake_ssn_per_cycle?.[ssnAddress] || {};

                for (const cycle of cyclesToCalculate) {
                    const cycleInfo = ssnCycleInfoMap[cycle];
                    if (!cycleInfo) continue;

                    const totalRewardsForCycle = new BN(cycleInfo.arguments[1]);
                    const totalStakeForCycle = new BN(cycleInfo.arguments[0]);
                    const delegStakeForCycle = delegStakePerCycleMap.get(cycle);

                    if (delegStakeForCycle && !delegStakeForCycle.isZero() && !totalStakeForCycle.isZero()) {
                        const cycleReward = delegStakeForCycle.mul(totalRewardsForCycle).div(totalStakeForCycle);
                        totalSsnReward = totalSsnReward.add(cycleReward);
                    }
                }
            } catch (e) {
                console.error(`- Ошибка при расчете наград для узла ${ssnAddress}:`, e);
                totalSsnReward = new BN(0);
            }

            rewardsBySsn[ssnAddress] = totalSsnReward;
        }
        
        console.log(`✅ Расчет наград завершен.`);
        return rewardsBySsn;
    }
    // <<< КОНЕЦ: Новая функция для расчета наград


    /**
     * Получает все узлы с активным стейком для указанного адреса
     */
    async getStakedNodes(walletAddress: string): Promise<NodeStakeInfo[]> {
        console.log(`\n🚀 Поиск стейков для адреса: ${walletAddress}`);
        
        // Нормализуем адрес
        const normalizedAddress = this.normalizeAddress(walletAddress);
        console.log(`📍 Нормализованный адрес: ${normalizedAddress}`);

        // Подготавливаем ПЕРВЫЙ batch запрос
        const initialQueries: Array<[string, string, any[]]> = [
            [this.implAddress, 'deposit_amt_deleg', [normalizedAddress]], // Депозиты пользователя
            [this.implAddress, 'ssnlist', []], // Список всех узлов
            [this.implAddress, 'lastrewardcycle', []], // <<<< НОВОЕ
            [this.implAddress, 'last_withdraw_cycle_deleg', [normalizedAddress]], // <<<< НОВОЕ
        ];

        try {
            // Выполняем ПЕРВЫЙ batch запрос
            const initialResults = await this.batchQuery(initialQueries);
            
            // Обрабатываем результаты
            const depositsResult = initialResults[0]?.result;
            const ssnListResult = initialResults[1]?.result;
            const lastRewardCycleResult = initialResults[2]?.result; // <<<< НОВОЕ
            const lastWithdrawResult = initialResults[3]?.result; // <<<< НОВОЕ


            if (!depositsResult || !ssnListResult || !lastRewardCycleResult) {
                throw new Error('Не удалось получить основные данные из контракта');
            }

            // Получаем депозиты пользователя
            const userDeposits = depositsResult.deposit_amt_deleg?.[normalizedAddress];
            
            if (!userDeposits || Object.keys(userDeposits).length === 0) {
                console.log('❌ У данного адреса нет активных стейков');
                return [];
            }
            
            const ssnList = ssnListResult.ssnlist;
            if (!ssnList) throw new Error('Не удалось получить список узлов');

            // --- НАЧАЛО: Подготовка и выполнение ВТОРОГО batch-запроса для данных по циклам ---
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
            // --- КОНЕЦ: ВТОРОЙ batch-запрос ---
            
            // Рассчитываем награды
            const rewardsBySsn = await this.calculateRewards(normalizedAddress, userDeposits, rewardData);

            console.log(`\n📊 Найдено стейков на ${Object.keys(userDeposits).length} узлах:`);
            console.log('=' + '='.repeat(80));

            const stakedNodes: NodeStakeInfo[] = [];
            let totalStaked = new BigNumber(0);
            let totalRewards = new BigNumber(0); // <<<< НОВОЕ

            for (const [ssnAddress, stakeAmount] of Object.entries(userDeposits)) {
                const ssnInfo = ssnList[ssnAddress];
                
                if (!ssnInfo) {
                    console.log(`⚠️  Узел ${ssnAddress} не найден в списке`);
                    continue;
                }

                const ssnArgs = ssnInfo.arguments;
                const ssnName = ssnArgs[3] || 'Неизвестно';
                const commissionRate = this.formatCommissionRate(ssnArgs[7]);
                const isActive = ssnArgs[0]?.constructor === 'True';
                const status = isActive ? 'Активен' : 'Неактивен';
                
                const stakeAmountStr = stakeAmount as string;
                const stakeAmountZil = this.formatZilAmount(stakeAmountStr);
                const rewardsBN = rewardsBySsn[ssnAddress] || new BN(0); // <<<< НОВОЕ
                const rewardsZil = this.formatZilAmount(rewardsBN.toString()); // <<<< НОВОЕ
                
                totalStaked = totalStaked.plus(new BigNumber(stakeAmountStr));
                totalRewards = totalRewards.plus(rewardsBN); // <<<< НОВОЕ

                const nodeInfo: NodeStakeInfo = {
                    ssnName,
                    ssnAddress: toBech32Address(ssnAddress),
                    stakeAmount: stakeAmountStr,
                    stakeAmountZil,
                    rewardsZil, // <<<< НОВОЕ
                    commissionRate,
                    status
                };

                stakedNodes.push(nodeInfo);

                // Выводим информацию
                console.log(`\n🎯 Узел: ${ssnName}`);
                console.log(`    📍 Адрес: ${toBech32Address(ssnAddress)}`);
                console.log(`    💰 Стейк: ${stakeAmountZil} ZIL`);
                console.log(`    🎁 Награды: ${rewardsZil} ZIL`); // <<<< НОВОЕ
                console.log(`    💹 Комиссия: ${commissionRate}%`);
                console.log(`    📊 Статус: ${status}`);
            }

            // Выводим общую статистику
            const totalStakedZil = this.formatZilAmount(totalStaked.toString());
            const totalRewardsZil = this.formatZilAmount(totalRewards.toString()); // <<<< НОВОЕ
            console.log('\n' + '=' + '='.repeat(80));
            console.log(`📈 ОБЩАЯ СТАТИСТИКА:`);
            console.log(`    🎯 Всего узлов со стейком: ${stakedNodes.length}`);
            console.log(`    💰 Общая сумма стейка: ${totalStakedZil} ZIL`);
            console.log(`    🎁 Общая сумма невостребованных наград: ${totalRewardsZil} ZIL`); // <<<< НОВОЕ
            console.log(`    🌐 Сеть: Mainnet`);
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
    console.log('🔥 Zilliqa Staking Checker v1.1 (with Rewards)\n');
    
    // Получаем адрес из аргументов командной строки
    const walletAddress = "zil1ruzwjhykmxlugf5a2wlm78z9cjv0u3rt0e84w2";
    
    if (!walletAddress) {
        console.error('❌ Ошибка: Укажите адрес кошелька');
        console.log('📝 Использование: bun run src/index.ts <wallet_address>');
        console.log('📝 Пример: bun run src/index.ts zil1234567890abcdef...');
        process.exit(1);
    }

    // Проверяем формат адреса
    if (!validation.isBech32(walletAddress) && !validation.isAddress(walletAddress)) {
        console.error('❌ Ошибка: Неверный формат адреса');
        console.log('💡 Адрес должен быть в формате bech32 (zil...) или checksum (0x...)');
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
