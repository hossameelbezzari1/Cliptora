<script setup lang="ts">
// Modified by CLIPTORA from n8n 2.45.0. See CLIPTORA_FORK.md.
import { useFavicon } from '@vueuse/core';
import { computed, onMounted, useCssModule, useTemplateRef } from 'vue';

import LogoIcon from './logo-icon.svg';
import LogoText from './logo-text.svg';

const props = defineProps<
	(
		| {
				size: 'large';
		  }
		| {
				size: 'small';
				collapsed: boolean;
		  }
	) & {
		releaseChannel?: 'stable' | 'beta' | 'nightly' | 'dev' | 'rc';
	}
>();

const { size, releaseChannel } = props;

const showLogoText = computed(() => {
	if (size === 'large') return true;
	return !props.collapsed;
});

const $style = useCssModule();
const containerClasses = computed(() => {
	if (size === 'large') {
		return [$style.logoContainer, $style.large];
	}
	return [
		$style.logoContainer,
		$style.sidebar,
		props.collapsed ? $style.sidebarCollapsed : $style.sidebarExpanded,
	];
});

const svg = useTemplateRef<{ $el: Element }>('logo');
onMounted(() => {
	if (releaseChannel !== 'dev' || !('createObjectURL' in URL)) {
		return;
	}

	const logoEl = svg.value!.$el;

	/** Reuse the SVG as the favicon. These must use HEX values. */
	const hexColor = '#898989';
	const faviconSvg = logoEl.outerHTML.replace('>', `><style>path { fill: ${hexColor}; }</style>`);
	const blob = new Blob([faviconSvg], { type: 'image/svg+xml' });
	useFavicon(URL.createObjectURL(blob));
});
</script>

<template>
	<div :class="containerClasses" data-test-id="n8n-logo">
		<LogoIcon ref="logo" :class="[$style.logo, { [$style.dev]: releaseChannel === 'dev' }]" />
		<LogoText v-if="showLogoText" :class="$style.logoText" />
		<slot />
	</div>
</template>

<style lang="scss" module>
.logoContainer {
	display: flex;
	justify-content: center;
	align-items: center;
	gap: var(--spacing--3xs);
	fill: var(--text-color--subtler);
}

.logo,
.logoText {
	width: auto;
	height: var(--height--3xs);
	max-width: 100%;
}

.logo {
	--logo-icon-fill: var(--cliptora-brand, var(--background--brand));

	&.dev {
		--logo-icon-fill: var(--text-color--subtler);
	}

	path {
		fill: var(--logo-icon-fill);
	}
}

.logoText path {
	fill: var(--text-color);
}

.logoText {
	color: var(--text-color);
}

.logoText text {
	fill: currentColor;
}

.large {
	margin-bottom: var(--spacing--xl);

	.logo,
	.logoText {
		height: var(--height--2xs);
	}
}
</style>
