/**
 * PgVectorQueryOptimizer.ts
 * Constructs optimized `pgvector` HNSW index queries with dynamic filtering for amenities and distance.
 * Ensures efficient approximate nearest neighbor (ANN) searches in PostgreSQL.
 */

export interface SearchFilters {
    minRating?: number;
    amenities?: string[];
    maxDistanceMeters?: number;
    userLat?: number;
    userLng?: number;
    isOpenNow?: boolean;
}

export class PgVectorQueryOptimizer {
    private tableName: string;
    private vectorColumn: string;

    constructor(tableName: string = 'venues', vectorColumn: string = 'embedding') {
        this.tableName = tableName;
        this.vectorColumn = vectorColumn;
    }

    public buildQuery(queryVector: number[], filters: SearchFilters, limit: number = 10): { sql: string; params: any[] } {
        const params: any[] = [`[${queryVector.join(',')}]`];
        let paramIndex = 2;

        let sql = `
      SELECT 
        id, name, description, rating, latitude, longitude,
        1 - (${this.vectorColumn} <=> $1::vector) AS similarity_score
      FROM ${this.tableName}
      WHERE 1=1
    `;

        if (filters.minRating !== undefined) {
            sql += ` AND rating >= $${paramIndex}`;
            params.push(filters.minRating);
            paramIndex++;
        }

        if (filters.amenities && filters.amenities.length > 0) {
            sql += ` AND amenities @> $${paramIndex}::text[]`;
            params.push(filters.amenities);
            paramIndex++;
        }

        if (filters.userLat !== undefined && filters.userLng !== undefined && filters.maxDistanceMeters !== undefined) {
            sql += ` AND ST_DistanceSphere(
        ST_MakePoint(longitude, latitude),
        ST_MakePoint($${paramIndex}, $${paramIndex + 1})
      ) <= $${paramIndex + 2}`;
            params.push(filters.userLng, filters.userLat, filters.maxDistanceMeters);
            paramIndex += 3;
        }

        if (filters.isOpenNow) {
            sql += ` AND is_currently_open = true`;
        }

        sql += `
      ORDER BY ${this.vectorColumn} <=> $1::vector ASC
      LIMIT $${paramIndex}
    `;
        params.push(limit);

        return { sql, params };
    }
}
