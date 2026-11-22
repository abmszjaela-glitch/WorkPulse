// Messages must contain configuration names/rules only, never supplied values.
export class ConfigurationError extends Error {
  constructor(message){super(message);this.name='ConfigurationError';}
}
