const COST_FIELDS = ['risk', 'timeSeconds'];

/** Validates the shared JSON contract before a matrix reaches the map or planner. */
export function validateGrid(grid) {
  const errors = [];
  if (!grid || typeof grid !== 'object') return ['Grid must be an object'];
  if (grid.crs !== 'IAU_2000:104905') errors.push('crs must be IAU_2000:104905 (Mars 2000 equirectangular, meters)');
  if (!Number.isInteger(grid.rows) || grid.rows < 1) errors.push('rows must be a positive integer');
  if (!Number.isInteger(grid.cols) || grid.cols < 1) errors.push('cols must be a positive integer');
  if (!grid.transform || !['originX', 'originY', 'pixelWidth', 'pixelHeight'].every((key) => Number.isFinite(grid.transform[key]))) {
    errors.push('transform must define finite originX, originY, pixelWidth, and pixelHeight');
  } else if (grid.transform.pixelWidth === 0 || grid.transform.pixelHeight === 0) {
    errors.push('pixelWidth and pixelHeight must be non-zero');
  }

  for (const field of [...COST_FIELDS, 'blocked']) {
    if (!Array.isArray(grid[field]) || grid[field].length !== grid.rows) {
      errors.push(`${field} must have exactly rows entries`);
      continue;
    }
    for (const [rowIndex, row] of grid[field].entries()) {
      if (!Array.isArray(row) || row.length !== grid.cols) {
        errors.push(`${field}[${rowIndex}] must have exactly cols entries`);
        continue;
      }
      for (const [colIndex, value] of row.entries()) {
        if (field === 'blocked') {
          if (typeof value !== 'boolean') errors.push(`blocked[${rowIndex}][${colIndex}] must be boolean`);
        } else if (grid.blocked?.[rowIndex]?.[colIndex] === true) {
          if (value !== null) errors.push(`${field}[${rowIndex}][${colIndex}] must be null in a blocked cell`);
        } else if (!Number.isFinite(value) || value <= 0) {
          errors.push(`${field}[${rowIndex}][${colIndex}] must be a positive finite number`);
        } else if (field === 'risk' && (value < 1 || value > 10)) {
          errors.push(`risk[${rowIndex}][${colIndex}] must be between 1 and 10`);
        }
      }
    }
  }
  return errors;
}

export async function loadGrid(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load grid (${response.status})`);
  const grid = await response.json();
  const errors = validateGrid(grid);
  if (errors.length) throw new Error(`Invalid grid:\n- ${errors.join('\n- ')}`);
  return grid;
}
