/**
 * VisaFormFiller
 * Maps extracted user data to specific PDF AcroForm fields, handling complex nested radio buttons and signature blocks.
 */

export interface FormFieldMapping {
    pdfFieldName: string;
    dataSourceKey: string;
    type: 'text' | 'checkbox' | 'radio' | 'signature';
    transform?: (value: any) => string | boolean;
}

export interface ExtractedUserData {
    fullName: string;
    dateOfBirth: string;
    passportNumber: string;
    nationality: string;
    monthlyIncome: number;
    remoteEmployer: string;
    [key: string]: any;
}

export class VisaFormFiller {
    private mappings: FormFieldMapping[];

    constructor(mappings: FormFieldMapping[]) {
        this.mappings = mappings;
    }

    public generateFillInstructions(userData: ExtractedUserData): Map<string, string | boolean> {
        const instructions = new Map<string, string | boolean>();

        for (const mapping of this.mappings) {
            const rawValue = userData[mapping.dataSourceKey];

            if (rawValue === undefined || rawValue === null) {
                continue; // Skip unmapped or missing data
            }

            let finalValue: string | boolean;

            if (mapping.transform) {
                finalValue = mapping.transform(rawValue);
            } else {
                finalValue = this.defaultTransform(rawValue, mapping.type);
            }

            instructions.set(mapping.pdfFieldName, finalValue);
        }

        return instructions;
    }

    private defaultTransform(value: any, type: string): string | boolean {
        switch (type) {
            case 'checkbox':
            case 'radio':
                return Boolean(value);
            case 'text':
                return String(value);
            case 'signature':
                // Signatures usually require an image path or base64 string
                return String(value);
            default:
                return String(value);
        }
    }

    public validateRequiredFields(userData: ExtractedUserData): string[] {
        const missing: string[] = [];
        for (const mapping of this.mappings) {
            if (userData[mapping.dataSourceKey] === undefined) {
                missing.push(mapping.dataSourceKey);
            }
        }
        return missing;
    }
}