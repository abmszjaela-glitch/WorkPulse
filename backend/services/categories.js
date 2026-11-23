import {randomUUID} from 'node:crypto';

export const createCategoryService=({repository})=>({
  list:(actor,filters)=>repository.categories(actor,'list',null,filters),
  lookup:actor=>repository.categories(actor,'lookup'),
  create:(actor,data)=>repository.categories(actor,'create',randomUUID(),data),
  update:(actor,id,data)=>repository.categories(actor,'update',id,data),
  remove:(actor,id)=>repository.categories(actor,'delete',id),
});
