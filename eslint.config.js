import base from '@arbendium/eslint-config-base';

export default [
	...base,
	{
		files: ['eslint.config.js'],
		rules: {
			'import/no-extraneous-dependencies': ['error', { devDependencies: true }]
		}
	}
];
