<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

interface MetricItem {
  name: string;
  value: number;
}

const props = defineProps<{
  data?: MetricItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

watch(
  () => props.data,
  (items) => {
    const list = Array.isArray(items) && items.length
      ? items
      : [{ name: '未知', value: 0 }];
  renderEcharts({
    legend: {
      bottom: 0,
      data: ['访问', '趋势'],
    },
    radar: {
      indicator: [
        ...list.map((item) => ({ name: item.name, max: Math.max(item.value, 1) })),
      ],
      radius: '60%',
      splitNumber: 8,
    },
    series: [
      {
        areaStyle: {
          opacity: 1,
          shadowBlur: 0,
          shadowColor: 'rgba(0,0,0,.2)',
          shadowOffsetX: 0,
          shadowOffsetY: 10,
        },
        data: [
          {
            itemStyle: {
              color: '#5ab1ef',
            },
            name: '访问设备',
            value: list.map((item) => item.value),
          },
        ],
        itemStyle: {
          // borderColor: '#fff',
          borderRadius: 10,
          borderWidth: 2,
        },
        symbolSize: 0,
        type: 'radar',
      },
    ],
    tooltip: {},
  });
  },
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
