<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

interface TrendItem {
  date: string;
  success: number;
  fail: number;
}

const props = defineProps<{
  data?: TrendItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

watch(
  () => props.data,
  (items) => {
    const list = Array.isArray(items) ? items : [];
  renderEcharts({
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: '2 %',
    },
    series: [
      {
        barMaxWidth: 60,
        data: list.map((item) => item.success),
        name: '登录成功',
        type: 'bar',
      },
      {
        barMaxWidth: 60,
        data: list.map((item) => item.fail),
        name: '登录失败',
        type: 'bar',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: {
          // color: '#4f69fd',
          width: 1,
        },
      },
      trigger: 'axis',
    },
    xAxis: {
      data: list.map((item) => item.date),
      type: 'category',
    },
    yAxis: {
      splitNumber: 4,
      type: 'value',
    },
    legend: {
      top: 0,
    },
  });
  },
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
