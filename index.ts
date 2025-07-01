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
    commissionRate: string;
    status: string;
}

interface BatchQueryResult {
    id: number;
    result: any;
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

    /**
     * Получает все узлы с активным стейком для указанного адреса
     */
    async getStakedNodes(walletAddress: string): Promise<NodeStakeInfo[]> {
        console.log(`\n🚀 Поиск стейков для адреса: ${walletAddress}`);
        
        // Нормализуем адрес
        const normalizedAddress = this.normalizeAddress(walletAddress);
        console.log(`📍 Нормализованный адрес: ${normalizedAddress}`);

        // Подготавливаем batch запросы
        const queries: Array<[string, string, any[]]> = [
            [this.implAddress, 'deposit_amt_deleg', [normalizedAddress]], // Депозиты пользователя
            [this.implAddress, 'ssnlist', []], // Список всех узлов
        ];

        try {
            // Выполняем batch запрос
            const results = await this.batchQuery(queries);
            
            // Обрабатываем результаты
            const depositsResult = results[0]?.result;
            const ssnListResult = results[1]?.result;

            if (!depositsResult || !ssnListResult) {
                throw new Error('Не удалось получить данные из контракта');
            }

            // Получаем депозиты пользователя
            const userDeposits = depositsResult.deposit_amt_deleg?.[normalizedAddress];
            
            if (!userDeposits || Object.keys(userDeposits).length === 0) {
                console.log('❌ У данного адреса нет активных стейков');
                return [];
            }

            // Получаем информацию о всех узлах
            const ssnList = ssnListResult.ssnlist;
            
            if (!ssnList) {
                throw new Error('Не удалось получить список узлов');
            }

            console.log(`\n📊 Найдено стейков на ${Object.keys(userDeposits).length} узлах:`);
            console.log('=' + '='.repeat(80));

            // Обрабатываем каждый стейк
            const stakedNodes: NodeStakeInfo[] = [];
            let totalStaked = new BigNumber(0);

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
                
                totalStaked = totalStaked.plus(new BigNumber(stakeAmountStr));

                const nodeInfo: NodeStakeInfo = {
                    ssnName,
                    ssnAddress: toBech32Address(ssnAddress),
                    stakeAmount: stakeAmountStr,
                    stakeAmountZil,
                    commissionRate,
                    status
                };

                stakedNodes.push(nodeInfo);

                // Выводим информацию
                console.log(`\n🎯 Узел: ${ssnName}`);
                console.log(`   📍 Адрес: ${toBech32Address(ssnAddress)}`);
                console.log(`   💰 Стейк: ${stakeAmountZil} ZIL`);
                console.log(`   💹 Комиссия: ${commissionRate}%`);
                console.log(`   📊 Статус: ${status}`);
            }

            // Выводим общую статистику
            const totalStakedZil = this.formatZilAmount(totalStaked.toString());
            console.log('\n' + '=' + '='.repeat(80));
            console.log(`📈 ОБЩАЯ СТАТИСТИКА:`);
            console.log(`   🎯 Всего узлов со стейком: ${stakedNodes.length}`);
            console.log(`   💰 Общая сумма стейка: ${totalStakedZil} ZIL`);
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
    console.log('🔥 Zilliqa Staking Checker v1.0\n');
    
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

