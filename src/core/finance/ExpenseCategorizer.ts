/**
 * ExpenseCategorizer
 * Formats extracted raw text into structured prompts for the Groq LLM to map items 
 * to standard corporate tax categories.
 */

export interface RawReceiptLine {
    text: string;
    isTotalZone: boolean;
    confidence: number;
}

export interface CategorizedExpense {
    originalText: string;
    category: 'MEAL' | 'TRANSPORT' | 'ACCOMMODATION' | 'WIFI' | 'OFFICE_SUPPLY' | 'OTHER';
    amount: number;
    taxAmount: number;
    isDeductible: boolean;
}

export class ExpenseCategorizer {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = 'llama3-70b-8192') {
        this.apiKey = apiKey;
        this.model = model;
    }

    public async categorize(lines: RawReceiptLine[]): Promise<CategorizedExpense[]> {
        const prompt = this.buildPrompt(lines);

        try {
            const response = await this.callGroqAPI(prompt);
            return this.parseResponse(response);
        } catch (error) {
            console.error('Categorization failed:', error);
            return this.fallbackCategorization(lines);
        }
    }

    private buildPrompt(lines: RawReceiptLine[]): string {
        const textContent = lines.map(l => `[${l.isTotalZone ? 'TOTAL_ZONE' : 'ITEM'}] ${l.text}`).join('\n');

        return `You are a corporate expense auditor. Analyze the following receipt lines and categorize them.
Rules:
1. Identify individual items and the final total/tax.
2. Map each item to one of: MEAL, TRANSPORT, ACCOMMODATION, WIFI, OFFICE_SUPPLY, OTHER.
3. Extract the numeric amount.
4. Determine if it's typically tax-deductible for a digital nomad (MEAL: 50%, WIFI: 100%, etc).
5. Return a JSON array of objects.

Receipt Data:
${textContent}

Output JSON format:
[
  {
    "originalText": "string",
    "category": "MEAL",
    "amount": 12.50,
    "taxAmount": 1.00,
    "isDeductible": true
  }
]`;
    }

    private async callGroqAPI(prompt: string): Promise<string> {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) throw new Error('Groq API failed');
        const data = await response.json();
        return data.choices[0].message.content;
    }

    private parseResponse(raw: string): CategorizedExpense[] {
        const parsed = JSON.parse(raw);
        // Handle both { items: [...] } and direct array [...]
        return parsed.items || parsed;
    }

    private fallbackCategorization(lines: RawReceiptLine[]): CategorizedExpense[] {
        // Simple keyword-based fallback if LLM fails
        return lines
            .filter(l => !l.isTotalZone && l.text.trim().length > 0)
            .map(l => {
                const lower = l.text.toLowerCase();
                let category: CategorizedExpense['category'] = 'OTHER';

                if (lower.includes('coffee') || lower.includes('lunch') || lower.includes('food')) category = 'MEAL';
                if (lower.includes('uber') || lower.includes('taxi') || lower.includes('parking')) category = 'TRANSPORT';
                if (lower.includes('wifi') || lower.includes('internet')) category = 'WIFI';

                // Naive amount extraction
                const match = l.text.match(/\$?(\d+\.\d{2})/);
                const amount = match ? parseFloat(match[1]) : 0;

                return {
                    originalText: l.text,
                    category,
                    amount,
                    taxAmount: 0,
                    isDeductible: category === 'WIFI' || category === 'OFFICE_SUPPLY'
                };
            });
    }
}
