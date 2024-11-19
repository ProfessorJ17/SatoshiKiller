const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

// Set up the base URL and file path
const baseUrl = 'https://privatekeyfinder.io/private-keys/bitcoin/';
const filePath = path.join(__dirname, 'btc.txt');

// Track checked pages
const checkedPages = new Set();

// Your API key
const apiKey = 'XXX';

// Function to generate a quantum random number up to a specific number of digits
async function getQuantumRandomPageNumber() {
    const maxNumber = BigInt('1929868153955269923726183083478131797547292737984581739710086052358636024906');

    try {
        // Replace with IBM's QRNG API endpoint
        const response = await axios.get('https://api.quantum-computing.ibm.com/v1/qrng', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,  // Use your API key
            }
        });

        if (response.data && response.data.random) {
            // Assuming response.data.random contains the quantum random number
            const hexString = response.data.random;
            const randomBigInt = BigInt('0x' + hexString) % maxNumber;
            return randomBigInt.toString(); // Convert to string for appending to URL
        } else {
            throw new Error('Failed to retrieve quantum random number');
        }
    } catch (error) {
        console.error(`Error fetching quantum random number: ${error.message}`);
        // Fallback to pseudo-random number generation if QRNG fails
        return getFallbackRandomPageNumber();
    }
}

// Function to generate a fallback pseudo-random number
function getFallbackRandomPageNumber() {
    const maxNumber = BigInt('1929868153955269923726183083478131797547292737984581739710086052358636024906');
    const randomBigInt = BigInt('0x' + crypto.randomBytes(64).toString('hex')) % maxNumber;
    return randomBigInt.toString(); // Convert to string for appending to URL
}

// Function to extract and log data
async function checkAndLogData(page) {
    const rows = await page.evaluate(() => {
        // Extract rows with address, balance, and private key information
        const rows = Array.from(document.querySelectorAll('tr'));
        return rows.map(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim());
            if (cells.length === 3 && cells[1].includes('Bal:')) {
                const balance = parseFloat(cells[1].replace('Bal:', '').trim());
                if (balance > 0) {
                    return {
                        address: cells[0],
                        balance: balance,
                        privateKey: cells[2],
                    };
                }
            }
            return null;
        }).filter(row => row !== null);
    });

    if (rows.length > 0) {
        for (const { address, balance, privateKey } of rows) {
            const logEntry = `${address} | BAL: ${balance} | Private Key: ${privateKey}\n`;
            fs.appendFileSync(filePath, logEntry);
            console.log(`Found: ${address} | BAL: ${balance} | Private Key: ${privateKey}`);
        }
        return true; // Found at least one balance > 0
    } else {
        console.log('No balance > 0 found on this page.');
        return false; // No balance > 0 found
    }
}

// Main function to repeatedly check the page
(async () => {
    const browser = await puppeteer.launch({
        headless: false,  // Set to false to see the browser
        devtools: true,   // Open DevTools automatically
        args: ['--start-maximized']  // Optional: start the browser maximized
    });

    const page = await browser.newPage();

    let startTime = Date.now();

    while (true) {
        try {
            // Generate a quantum or fallback random page number
            const pageNumber = await getQuantumRandomPageNumber();
            const url = `${baseUrl}${pageNumber}`;

            // Ensure we don't check the same page twice
            if (checkedPages.has(url)) {
                console.log(`Page ${url} already checked, skipping...`);
                continue;
            }
            checkedPages.add(url);

            await page.goto(url);

            // Wait for the specific text that indicates the page has loaded the data
            await page.waitForFunction(() => {
                const textContent = document.body.textContent || '';
                return textContent.includes('Bitcoin keys page') && textContent.includes('Total balance:');
            }, { timeout: 60000 });

            // Optionally, check if the total balance is greater than zero before proceeding
            const totalBalance = await page.evaluate(() => {
                const balanceText = document.body.textContent.match(/Total balance: ([0-9\.]+)/);
                return balanceText ? parseFloat(balanceText[1]) : 0;
            });

            if (totalBalance > 0) {
                console.log(`Total balance: ${totalBalance}, checking for individual balances...`);
                await checkAndLogData(page);
            } else {
                console.log('Total balance is 0, skipping to next page...');
            }

            const waitTime = Math.random() * (8 - 4) + 4;
            console.log(`Waiting for ${waitTime.toFixed(2)} seconds before checking the next page...`);
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

            // Check if 3 minutes have passed
            if (Date.now() - startTime > 3 * 60 * 1000) {
                console.log('Taking a 20-second break...');
                await new Promise(resolve => setTimeout(resolve, 20000));  // 20-second break
                startTime = Date.now();  // Reset the timer
            }
        } catch (error) {
            console.log(`Error during page navigation or processing: ${error.message}`);
        }
    }

    await browser.close();
})();
