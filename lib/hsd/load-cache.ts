/** Bounded completed resources plus in-flight deduplication. Failures are never
 * sticky, and evicted resources are still valid for callers holding a reference. */
export class LoadCache<K,V> {
  private values=new Map<K,V>();
  private pending=new Map<K,Promise<V>>();
  constructor(private limit:number){}
  get(key:K,load:()=>Promise<V>):Promise<V> {
    if(this.values.has(key)){const value=this.values.get(key)!;this.values.delete(key);this.values.set(key,value);return Promise.resolve(value);}
    const pending=this.pending.get(key);if(pending)return pending;
    const task=Promise.resolve().then(load).then(value=>{
      if(this.values.size>=this.limit)this.values.delete(this.values.keys().next().value!);
      this.values.set(key,value);return value;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,task);return task;
  }
}
